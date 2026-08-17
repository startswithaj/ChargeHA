import type {
  CallContext,
  ChargerAdapter,
  ChargerState,
  ChargerStatus,
} from "@chargeha/shared";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { OcppChargerHandle } from "./OcppCentralSystem.ts";
import type { OcppLiveData } from "./OcppTypes.ts";
import { chargingProfilePayload } from "./OcppMessages.ts";
import type { ChargePointStatus } from "./OcppMessages.ts";

const STATUS_MAP: Record<ChargePointStatus, ChargerStatus> = {
  Available: "available",
  Preparing: "preparing",
  Charging: "charging",
  SuspendedEVSE: "suspended",
  SuspendedEV: "suspended",
  Finishing: "finishing",
  // Reserved (RFID/app booking) = won't charge right now, not "ready" —
  // statusDetail carries the raw "Reserved" for the UI.
  Reserved: "suspended",
  Unavailable: "faulted",
  Faulted: "faulted",
};

// Statuses meaning a cable is present (Available/Reserved mean it is not).
const PLUGGED_STATUSES: ReadonlySet<ChargePointStatus> = new Set([
  "Preparing",
  "Charging",
  "SuspendedEVSE",
  "SuspendedEV",
  "Finishing",
]);

export interface OcppAdapterConfig {
  chargerId: string;
  meterTimeoutSeconds: number;
  disconnectGraceSeconds: number;
  maxAmps: number;
  minAmps: number;
  // From the plugin's phases setting — a charger can't report this.
  phases: number;
}

// Push-based adapter: all reads come from the central system's cache.
export class OcppChargerAdapter implements ChargerAdapter {
  // Tracks whether the last computed state was stale, so the dashboard's
  // frequent polling only writes a log row on the transition, not every poll.
  private wasStale = false;
  private disconnectedSince: number | null = null;

  constructor(
    private readonly config: OcppAdapterConfig,
    // Bound to this charger, so the adapter cannot command another one.
    private readonly cs: OcppChargerHandle,
    private readonly dbLog: PluginDbLogger,
  ) {}

  pollIntervalSeconds(): null {
    return null;
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  startCharging(ctx: CallContext): Promise<boolean> {
    this.command("info", "remoteStart", {}, ctx);
    return this.cs.remoteStart();
  }

  stopCharging(ctx: CallContext): Promise<boolean> {
    this.command("info", "remoteStop", {}, ctx);
    return this.cs.remoteStop();
  }

  // Three-tier profile per the HA-integration pattern.
  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    const tx = this.cs.getData().transactionId ?? undefined;
    this.command("debug", "setChargeAmps", {
      amps,
      transactionId: tx ?? null,
    }, ctx);
    return this.cs.setChargingProfiles([
      chargingProfilePayload("ChargePointMaxProfile", amps),
      chargingProfilePayload("TxDefaultProfile", amps),
      ...(tx !== undefined
        ? [chargingProfilePayload("TxProfile", amps, tx)]
        : []),
    ]);
  }

  getChargerState(ctx: CallContext): Promise<ChargerState> {
    return Promise.resolve(this.buildState(this.cs.getData(), ctx));
  }

  private command(
    level: "info" | "debug",
    name: string,
    payload: Record<string, unknown>,
    ctx: CallContext,
  ): void {
    this.dbLog.log(level, `${name} (${this.config.chargerId})`, {
      payload: { chargerId: this.config.chargerId, ...payload },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });
  }

  private buildState(data: OcppLiveData, ctx: CallContext): ChargerState {
    const meterAgeMs = data.lastMeterValuesAt === null
      ? null
      : Date.now() - data.lastMeterValuesAt;
    // OCPP 1.6 MeterValues are transaction-scoped: an idle charger sends
    // none, so silence only signals trouble while a transaction is active.
    const meterStale = data.transactionId !== null && meterAgeMs !== null &&
      meterAgeMs > this.config.meterTimeoutSeconds * 1000;
    // Log only the transition into/out of staleness — this is read on every
    // dashboard poll, and a stuck charger would otherwise flood the table.
    if (meterStale && !this.wasStale) {
      this.dbLog.warn(`Meter values stale (${this.config.chargerId})`, {
        payload: {
          chargerId: this.config.chargerId,
          meterAgeMs,
          timeoutSeconds: this.config.meterTimeoutSeconds,
        },
        origin: ctx.origin,
        traceId: ctx.traceId,
      });
    } else if (!meterStale && this.wasStale) {
      this.dbLog.info(`Meter values fresh again (${this.config.chargerId})`, {
        payload: { chargerId: this.config.chargerId },
        origin: ctx.origin,
        traceId: ctx.traceId,
      });
    }
    this.wasStale = meterStale;
    if (data.connected) {
      this.disconnectedSince = null;
    } else if (this.disconnectedSince === null) {
      this.disconnectedSince = Date.now();
    }
    // Chargers drop and re-dial the socket routinely; a fault that clears
    // itself within the grace window was never worth alarming on.
    const graceMs = this.config.disconnectGraceSeconds * 1000;
    const socketDown = this.disconnectedSince !== null &&
      Date.now() - this.disconnectedSince >= graceMs;
    const disconnected = socketDown || meterStale;
    const charging = isChargingNow(data);
    const status = resolveStatus(disconnected, data.status, charging);

    return {
      chargerId: this.config.chargerId,
      isCharging: !disconnected && charging,
      isPluggedIn: resolvePluggedIn(data.status, charging),
      // Measurand fallback chain: power measurand → register-delta
      // derivation (both in OcppCentralSystem.readMeterValues) → current ×
      // voltage (derivedPowerKw below) → null (recorded as zero).
      chargeAmps: data.currentA ?? null,
      chargeAmpsMax: this.config.maxAmps,
      chargeAmpsMin: this.config.minAmps,
      chargePowerKw: data.powerW !== null
        ? data.powerW / 1000
        : derivedPowerKw(data, this.config.phases),
      chargerVoltage: data.voltageV,
      chargerPhases: this.config.phases,
      energyAddedKwh: sessionEnergyKwh(data),
      status,
      statusDetail: statusDetail(data, disconnected),
      controlMode: "amps",
      lastUpdated: data.lastUpdated,
    };
  }
}

function resolveStatus(
  disconnected: boolean,
  status: ChargePointStatus | null,
  charging: boolean,
): ChargerStatus {
  if (disconnected) return "faulted";
  // A live session with no status yet is not "available" — that reads as
  // nothing plugged in while energy is flowing.
  if (status === null) return charging ? "charging" : "available";
  return STATUS_MAP[status];
}

// null means "unknown", which the controller engine treats as plugged in —
// only a definite false blocks charging. A session running with no status
// yet is definitely plugged in, so say so rather than leaving it unknown.
function resolvePluggedIn(
  status: ChargePointStatus | null,
  charging: boolean,
): boolean | null {
  if (status !== null) return PLUGGED_STATUSES.has(status);
  return charging ? true : null;
}

// A reconnecting charger re-announces connector status but has no reason to
// resend Charging. After a ChargeHA restart the live transaction and real
// power are the only honest evidence, trusted over a stale status.
function isChargingNow(data: OcppLiveData): boolean {
  if (data.status === "Charging") return true;
  // Inference fills a gap; it must never contradict the charger. Any other
  // explicit status (SuspendedEV/EVSE, Finishing, Available, Reserved...)
  // is the charger saying it is not delivering energy, and it wins even
  // while a stale power reading lingers in the cache. Only "no status yet"
  // and Preparing — the two states a mid-session reconnect leaves behind —
  // are open to inference.
  if (data.status !== null && data.status !== "Preparing") return false;
  return data.transactionId !== null && (data.powerW ?? 0) > 0;
}

// Tier 3: no power measurand, no register delta, derive from amps × volts.
// Per-phase currents: sum stays exact on unbalanced load, config.phases
// unused. One unphased current: nothing to sum, scale by config.phases.
function derivedPowerKw(data: OcppLiveData, phases: number): number | null {
  if (data.voltageV === null) return null;
  if (data.currentSumA !== null) {
    return (data.currentSumA * data.voltageV) / 1000;
  }
  if (data.currentA === null) return null;
  return (data.currentA * data.voltageV * phases) / 1000;
}

function sessionEnergyKwh(data: OcppLiveData): number {
  if (data.meterStartWh === null || data.energyRegisterWh === null) return 0;
  return Math.max(0, data.energyRegisterWh - data.meterStartWh) / 1000;
}

function statusDetail(data: OcppLiveData, disconnected: boolean): string {
  if (!data.connected) return "disconnected";
  if (disconnected) return "stale (no MeterValues)";
  if (data.status === null) return "connected, no status yet";
  return data.errorCode && data.errorCode !== "NoError"
    ? `${data.status} (${data.errorCode})`
    : data.status;
}
