import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { type OcppFrame, OcppFraming, PendingCalls } from "./OcppFraming.ts";
import {
  authorizeReq,
  bootNotificationReq,
  type ChargePointStatus,
  meterValuesReq,
  startTransactionReq,
  statusNotificationReq,
} from "./OcppMessages.ts";

export interface OcppChargerInfo {
  vendor: string;
  model: string;
  firmwareVersion: string;
}

/** The persisted mid-charge state — id + session meter baseline. */
export interface ActiveTransaction {
  transactionId: number;
  meterStartWh: number;
}

export interface OcppLiveData {
  connected: boolean;
  status: ChargePointStatus | null;
  errorCode: string | null;
  info: OcppChargerInfo | null;
  transactionId: number | null;
  /** Wh register at StartTransaction — session energy baseline. */
  meterStartWh: number | null;
  /** Latest measurand readings (nulls = charger never sent them). */
  powerW: number | null;
  currentA: number | null;
  voltageV: number | null;
  energyRegisterWh: number | null;
  lastMeterValuesAt: number | null;
  lastUpdated: string;
}

const freshData = (): OcppLiveData => ({
  connected: false,
  status: null,
  errorCode: null,
  info: null,
  transactionId: null,
  meterStartWh: null,
  powerW: null,
  currentA: null,
  voltageV: null,
  energyRegisterWh: null,
  lastMeterValuesAt: null,
  lastUpdated: new Date().toISOString(),
});

/** Plugin-internal OCPP 1.6J central system for a single charger.
 *  Owns the live socket, answers charger-initiated CALLs, tracks pushed
 *  state, and sends our CALLs (RemoteStart/Stop, SetChargingProfile...). */
export class OcppCentralSystem {
  private socket: WebSocket | null = null;
  private data: OcppLiveData = freshData();
  private readonly pending = new PendingCalls();
  private transactionCounter = 0;

  constructor(
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
    /** Persists the active transaction (null = cleared) so a mid-charge
     *  restart keeps stop-control. Failures are logged, never thrown. */
    private readonly persistTransaction: (
      tx: ActiveTransaction | null,
    ) => Promise<void>,
  ) {}

  getData(): OcppLiveData {
    return this.data;
  }

  /** Seed a persisted mid-charge transaction on boot. No-op once live. */
  restoreTransaction(tx: ActiveTransaction): void {
    if (this.data.transactionId !== null) return;
    this.transactionCounter = tx.transactionId;
    this.patch({
      transactionId: tx.transactionId,
      meterStartWh: tx.meterStartWh,
    });
  }

  /** Adopt an upgraded socket (from wsRoutes). A reconnect replaces the old
   *  socket; state is retained (PRD: reconnection restores state). */
  attach(socket: WebSocket): void {
    this.socket?.close();
    this.socket = socket;
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onmessage = (event) => this.onMessage(String(event.data));
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onclose = () => this.onClose(socket);
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onerror = (event) => this.logger.warn(`OCPP socket error: ${event}`);
    this.patch({ connected: true });
    this.logger.info("Charger connected");
  }

  shutdown(): void {
    this.pending.rejectAll("Central system shutting down");
    this.socket?.close();
    this.socket = null;
  }

  // ── Outgoing commands ────────────────────────────────────────────────

  async remoteStart(): Promise<boolean> {
    const res = await this.send("RemoteStartTransaction", {
      connectorId: 1,
      idTag: "chargeha",
    });
    return isAccepted(res);
  }

  async remoteStop(): Promise<boolean> {
    if (this.data.transactionId === null) return false;
    const res = await this.send("RemoteStopTransaction", {
      transactionId: this.data.transactionId,
    });
    return isAccepted(res);
  }

  async setChargingProfiles(
    payloads: Array<Record<string, unknown>>,
  ): Promise<boolean> {
    const results = await Promise.all(
      payloads.map((p) => this.send("SetChargingProfile", p)),
    );
    return results.every(isAccepted);
  }

  // GetConfiguration round trip: proves the charger answers calls.
  async ping(): Promise<{ latencyMs: number }> {
    const startedAt = performance.now();
    await this.send("GetConfiguration", { key: ["HeartbeatInterval"] });
    return { latencyMs: Math.round(performance.now() - startedAt) };
  }

  async changeConfiguration(key: string, value: string): Promise<boolean> {
    const res = await this.send("ChangeConfiguration", { key, value });
    return isAccepted(res);
  }

  // ── Incoming ─────────────────────────────────────────────────────────

  private onMessage(raw: string): void {
    try {
      const frame = OcppFraming.decode(raw);
      if (this.pending.settle(frame)) return;
      if (frame.kind !== "call") return;
      this.reply(frame);
    } catch (error) {
      this.logger.warn(`Bad OCPP message dropped: ${error}`);
    }
  }

  private reply(frame: OcppFrame & { kind: "call" }): void {
    try {
      const payload = this.handleAction(frame.action, frame.payload);
      const message = payload === null
        ? OcppFraming.error(frame.id, "NotImplemented", frame.action)
        : OcppFraming.result(frame.id, payload);
      this.socket?.send(message);
    } catch (error) {
      // OCPP-J: a CALL with a bad payload still gets a targeted CALLERROR —
      // never a silent drop that leaves the charger waiting on its timeout.
      this.logger.warn(`OCPP ${frame.action} payload rejected: ${error}`);
      this.socket?.send(
        OcppFraming.error(frame.id, "FormationViolation", String(error)),
      );
    }
  }

  /** Returns the CALLRESULT payload, or null for unsupported actions. */
  private handleAction(action: string, payload: unknown): unknown | null {
    this.dbLog.debug(`← ${action}`, { payload: { raw: payload } });
    switch (action) {
      case "BootNotification": {
        const boot = bootNotificationReq.parse(payload);
        this.patch({
          info: {
            vendor: boot.chargePointVendor,
            model: boot.chargePointModel,
            firmwareVersion: boot.firmwareVersion ?? "unknown",
          },
        });
        return {
          status: "Accepted",
          currentTime: new Date().toISOString(),
          interval: 300,
        };
      }
      case "Heartbeat":
        return { currentTime: new Date().toISOString() };
      case "StatusNotification": {
        const s = statusNotificationReq.parse(payload);
        this.patch({ status: s.status, errorCode: s.errorCode });
        return {};
      }
      case "MeterValues": {
        this.patch({
          ...this.readMeterValues(meterValuesReq.parse(payload)),
          lastMeterValuesAt: Date.now(),
        });
        return {};
      }
      case "StartTransaction": {
        const start = startTransactionReq.parse(payload);
        this.transactionCounter++;
        this.patch({
          transactionId: this.transactionCounter,
          meterStartWh: start.meterStart,
        });
        this.persistTransaction({
          transactionId: this.transactionCounter,
          meterStartWh: start.meterStart,
        }).catch((error) =>
          this.logger.error("Persist transaction failed:", error)
        );
        return {
          transactionId: this.transactionCounter,
          idTagInfo: { status: "Accepted" },
        };
      }
      case "StopTransaction": {
        this.patch({ transactionId: null, meterStartWh: null });
        this.persistTransaction(null).catch((error) =>
          this.logger.error("Persist transaction failed:", error)
        );
        return { idTagInfo: { status: "Accepted" } };
      }
      case "Authorize":
        authorizeReq.parse(payload);
        return { idTagInfo: { status: "Accepted" } };
      default:
        return null;
    }
  }

  private readMeterValues(
    mv: ReturnType<typeof meterValuesReq.parse>,
  ): Partial<OcppLiveData> {
    const samples = mv.meterValue.flatMap((entry) => entry.sampledValue);
    const read = (measurand: string) => {
      const sample = samples.find(
        (s) => (s.measurand ?? "Energy.Active.Import.Register") === measurand,
      );
      return sample ? parseFloat(sample.value) : null;
    };
    const rawPower = read("Power.Active.Import");
    const powerUnit = samples.find(
      (s) => s.measurand === "Power.Active.Import",
    )?.unit;
    const energyRegisterWh = read("Energy.Active.Import.Register");
    return {
      // PRD fallback chain tier 2: no power measurand → derive from how
      // fast the register counts up. Tier 3 (current × voltage) stays in
      // the adapter for when neither power nor a register delta exists.
      powerW: rawPower === null
        ? this.derivePowerFromRegister(energyRegisterWh)
        : toWatts(rawPower, powerUnit),
      currentA: read("Current.Import"),
      voltageV: read("Voltage"),
      energyRegisterWh,
    };
  }

  /** Watts from successive register readings: (ΔWh × 3600) / Δseconds.
   *  Needs two readings — the first after boot/reconnect yields null; a
   *  negative delta (register reset) yields null rather than a guess. */
  private derivePowerFromRegister(registerWh: number | null): number | null {
    const prevWh = this.data.energyRegisterWh;
    const prevAt = this.data.lastMeterValuesAt;
    if (registerWh === null || prevWh === null || prevAt === null) return null;
    const elapsedSec = (Date.now() - prevAt) / 1000;
    if (elapsedSec <= 0) return null;
    const deltaWh = registerWh - prevWh;
    if (deltaWh < 0) return null;
    return (deltaWh * 3600) / elapsedSec;
  }

  private onClose(socket: WebSocket): void {
    if (this.socket !== socket) return; // replaced by a reconnect
    this.socket = null;
    this.pending.rejectAll("Charger disconnected");
    this.patch({ connected: false });
    this.logger.warn("Charger disconnected");
  }

  private async send(action: string, payload: unknown): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Charger not connected");
    }
    const id = crypto.randomUUID();
    this.dbLog.debug(`→ ${action}`, { payload: { raw: payload } });
    socket.send(OcppFraming.call(id, action, payload));
    return await this.pending.wait(id);
  }

  private patch(delta: Partial<OcppLiveData>): void {
    this.data = {
      ...this.data,
      ...delta,
      lastUpdated: new Date().toISOString(),
    };
  }
}

function isAccepted(res: unknown): boolean {
  return typeof res === "object" && res !== null &&
    (res as { status?: string }).status === "Accepted";
}

/** OCPP allows Power.Active.Import in W (default) or kW. */
function toWatts(value: number, unit: string | undefined): number {
  return unit === "kW" ? value * 1000 : value;
}
