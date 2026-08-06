import type {
  CallContext,
  ChargerAdapter,
  ChargerInfo,
  ChargerState,
  ChargerStatus,
} from "@chargeha/shared";
import type { OcppChargerHandle, OcppLiveData } from "./OcppCentralSystem.ts";
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
  maxAmps: number;
  minAmps: number;
  /** From the plugin's phases setting — a charger can't report this. */
  phases: number;
}

/** Push-based adapter: all reads come from the central system's cache. */
export class OcppChargerAdapter implements ChargerAdapter {
  constructor(
    private readonly config: OcppAdapterConfig,
    /** Bound to this charger, so the adapter cannot command another one. */
    private readonly cs: OcppChargerHandle,
  ) {}

  pollIntervalSeconds(): null {
    return null;
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  startCharging(_ctx: CallContext): Promise<boolean> {
    return this.cs.remoteStart();
  }

  stopCharging(_ctx: CallContext): Promise<boolean> {
    return this.cs.remoteStop();
  }

  /** Three-tier profile per the HA-integration pattern. */
  setChargeAmps(amps: number, _ctx: CallContext): Promise<boolean> {
    const tx = this.cs.getData().transactionId ?? undefined;
    return this.cs.setChargingProfiles([
      chargingProfilePayload("ChargePointMaxProfile", amps),
      chargingProfilePayload("TxDefaultProfile", amps),
      ...(tx !== undefined
        ? [chargingProfilePayload("TxProfile", amps, tx)]
        : []),
    ]);
  }

  getChargerState(_ctx: CallContext): Promise<ChargerState> {
    return Promise.resolve(this.buildState(this.cs.getData()));
  }

  getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    const data = this.cs.getData();
    return Promise.resolve({
      id: this.config.chargerId,
      name: data.info?.model ?? this.config.chargerId,
      vendor: data.info?.vendor ?? "unknown",
      model: data.info?.model ?? "unknown",
      firmwareVersion: data.info?.firmwareVersion ?? "unknown",
      maxAmps: this.config.maxAmps,
      minAmps: this.config.minAmps,
      phases: this.config.phases,
      connectorCount: 1,
      controlMode: "amps",
    });
  }

  private buildState(data: OcppLiveData): ChargerState {
    const meterAgeMs = data.lastMeterValuesAt === null
      ? null
      : Date.now() - data.lastMeterValuesAt;
    const meterStale = meterAgeMs !== null &&
      meterAgeMs > this.config.meterTimeoutSeconds * 1000;
    const disconnected = !data.connected || meterStale;
    const status = resolveStatus(disconnected, data.status);

    return {
      chargerId: this.config.chargerId,
      isCharging: !disconnected && data.status === "Charging",
      isPluggedIn: data.status === null
        ? null
        : PLUGGED_STATUSES.has(data.status),
      // Measurand fallback chain: power measurand → register-delta
      // derivation (both in OcppCentralSystem.readMeterValues) → current ×
      // voltage (derivedPowerKw below) → null (recorded as zero).
      chargeAmps: data.currentA ?? null,
      chargeAmpsMax: this.config.maxAmps,
      chargeAmpsMin: this.config.minAmps,
      chargePowerKw: data.powerW !== null
        ? data.powerW / 1000
        : derivedPowerKw(data),
      chargerVoltage: data.voltageV,
      chargerPhases: this.config.phases,
      energyAddedKwh: sessionEnergyKwh(data),
      status,
      statusDetail: statusDetail(data, disconnected),
      lastUpdated: data.lastUpdated,
    };
  }
}

function resolveStatus(
  disconnected: boolean,
  status: ChargePointStatus | null,
): ChargerStatus {
  if (disconnected) return "faulted";
  if (status === null) return "available";
  return STATUS_MAP[status];
}

function derivedPowerKw(data: OcppLiveData): number | null {
  if (data.currentA === null || data.voltageV === null) return null;
  return (data.currentA * data.voltageV) / 1000;
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
