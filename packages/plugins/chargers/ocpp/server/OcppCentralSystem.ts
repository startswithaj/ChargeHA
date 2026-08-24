import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { type OcppFrame, OcppFraming } from "./OcppFraming.ts";
import { OcppConnection } from "./OcppConnection.ts";
import {
  freshData,
  type OcppChargerInfo,
  type OcppLiveData,
} from "./OcppTypes.ts";
import {
  authorizeReq,
  bootNotificationReq,
  chargingProfilePayload,
  type ChargingProfileRequest,
  meterValuesReq,
  remoteStartTxProfile,
  startTransactionReq,
  statusNotificationReq,
  stopTransactionReq,
} from "./OcppMessages.ts";
import { readMeterValueFields } from "./OcppMeterValues.ts";
import { measurandWarningFor } from "./OcppMeasurands.ts";
import { OcppMeasurandNegotiator } from "./OcppMeasurandNegotiator.ts";
import { OcppMaxAmpsDetector } from "./OcppMaxAmpsDetector.ts";

// Several can turn up in one window (two chargers, or an old id still
// retrying), so the user picks rather than us guessing.
export interface OcppSeenCharger {
  chargerId: string;
  info: OcppChargerInfo | null;
  at: number;
}

interface ChargerStamp {
  chargerId: string;
  at: number;
}

export interface OcppPairingState {
  armed: boolean;
  expiresAt: number | null;
  // Everything that connected during this window, newest last.
  seen: OcppSeenCharger[];
}

const idlePairing = (): OcppPairingState => ({
  armed: false,
  expiresAt: null,
  seen: [],
});

// Refreshes rather than appends: chargers reconnect often, and a row per
// reconnect would be noise.
function withCharger(
  seen: OcppSeenCharger[],
  chargerId: string,
): OcppSeenCharger[] {
  const at = Date.now();
  const known = seen.some((c) => c.chargerId === chargerId);
  if (!known) return [...seen, { chargerId, info: null, at }];
  return seen.map((c) => c.chargerId === chargerId ? { ...c, at } : c);
}

// Bound to one charge point, so an adapter cannot command another charger nor
// reach plugin-wide operations like pairing.
export interface OcppChargerHandle {
  getData(): OcppLiveData;
  remoteStart(amps?: number): Promise<boolean>;
  remoteStop(): Promise<boolean>;
  setChargingProfiles(profiles: ChargingProfileRequest[]): Promise<boolean>;
  ping(): Promise<{ latencyMs: number }>;
}

// Plugin-internal OCPP 1.6J central system for a single charger.
export class OcppCentralSystem {
  private readonly connections = new Map<string, OcppConnection>();
  private pairing: OcppPairingState = idlePairing();
  // A charger set up before listening started retries every couple of seconds
  // — worth showing the user, not burying in the log.
  private knocking: ChargerStamp | null = null;
  // Separate from `knocking`: every retry refreshes that one, so rate-limiting
  // on it would log a given id exactly once, ever.
  private lastLogged: ChargerStamp | null = null;
  // Not per connection: the reconnect it must survive destroys that object.
  private readonly negotiator: OcppMeasurandNegotiator;
  private readonly maxAmpsDetector: OcppMaxAmpsDetector;

  constructor(
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
    // Async because saving a row must take effect on an already-open socket's
    // very next message.
    private readonly hasChargerRow: (chargePointId: string) => Promise<boolean>,
  ) {
    this.negotiator = new OcppMeasurandNegotiator(
      (id, action, payload) => this.send(id, action, payload),
      logger,
      dbLog,
    );
    this.maxAmpsDetector = new OcppMaxAmpsDetector(
      (id, action, payload) => this.send(id, action, payload),
      dbLog,
    );
  }

  // Fresh state rather than nothing, so callers never special-case "no
  // connection yet".
  getData(chargePointId: string): OcppLiveData {
    return this.connections.get(chargePointId)?.getData() ?? freshData();
  }

  // Lets the panel prove reachability before the user commits a charger id.
  armPairing(ttlMs: number): void {
    // Read through pairingState() so a lapsed window's chargers are not
    // carried into the next one; the raw field stays armed until replaced.
    const previous = this.pairingState();
    this.pairing = {
      armed: true,
      expiresAt: Date.now() + ttlMs,
      // Kept across a renewal — the panel renews every minute, and forgetting
      // what was found would empty the picker.
      seen: previous.armed ? previous.seen : [],
    };
    this.logger.info(`OCPP pairing armed for ${Math.round(ttlMs / 1000)}s`);
  }

  // Sockets tolerated only because pairing was open must not outlive it; one
  // whose id now has a charger row is adopted and left alone.
  async cancelPairing(): Promise<void> {
    this.pairing = idlePairing();
    await Promise.all(
      [...this.connections.entries()].map(async ([id, connection]) => {
        if (!(await this.hasChargerRow(id))) {
          connection.close("Pairing cancelled");
        }
      }),
    );
  }

  // Expired windows report themselves closed without needing a timer.
  pairingState(): OcppPairingState {
    if (!this.pairing.armed) return this.pairing;
    if (
      this.pairing.expiresAt !== null && Date.now() > this.pairing.expiresAt
    ) {
      return idlePairing();
    }
    return this.pairing;
  }

  // wsRoutes gate: may an unconfigured charger id connect right now?
  acceptsPairing(): boolean {
    return this.pairingState().armed;
  }

  // Whether an id may act beyond BootNotification is decided fresh per message
  // via `hasChargerRow`, not cached here.
  attach(socket: WebSocket, opts: { chargerId: string }): void {
    const id = opts.chargerId;
    // Only the previous socket for THIS id — closing another id's socket is
    // what made a second charger evict the first. onClose disqualifies itself
    // once the new entry is in the map, so this is the last chance to fail the
    // replaced connection's callers.
    this.connections.get(id)?.close("Charger reconnected");
    const connection = new OcppConnection(socket, id, this.logger, this.dbLog);
    this.connections.set(id, connection);
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onmessage = (event) => this.onMessage(id, String(event.data));
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onclose = () => this.onClose(id, socket);
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onerror = (event) => this.logger.warn(`OCPP socket error: ${event}`);
    this.logger.info(`Charger ${id} connected`);
  }

  // Adapters take this so they cannot command another charger.
  forCharger(chargePointId: string): OcppChargerHandle {
    return {
      getData: () => this.getData(chargePointId),
      remoteStart: (amps) => this.remoteStart(chargePointId, amps),
      remoteStop: () => this.remoteStop(chargePointId),
      setChargingProfiles: (payloads) =>
        this.setChargingProfiles(chargePointId, payloads),
      ping: () => this.ping(chargePointId),
    };
  }

  // Recorded so the panel can offer to accept an unconfigured charger.
  noteRejected(chargerId: string): void {
    this.knocking = { chargerId, at: Date.now() };
  }

  // Who has been knocking in the last 30 seconds, if anyone.
  knockingCharger(): string | null {
    if (this.knocking === null) return null;
    return Date.now() - this.knocking.at < 30_000
      ? this.knocking.chargerId
      : null;
  }

  // First rejection, then at most once a minute — a 2s retry loop must not
  // fill the log.
  shouldLogRejection(chargerId: string): boolean {
    const last = this.lastLogged;
    const due = last === null || last.chargerId !== chargerId ||
      Date.now() - last.at > 60_000;
    if (due) this.lastLogged = { chargerId, at: Date.now() };
    return due;
  }

  notePairedCharger(chargerId: string): void {
    this.updateSeen((seen) => withCharger(seen, chargerId));
  }

  // Only while a window is open — an expired one must not collect chargers
  // for a picker nobody is watching.
  private updateSeen(
    map: (seen: OcppSeenCharger[]) => OcppSeenCharger[],
  ): void {
    if (!this.pairingState().armed) return;
    this.pairing = { ...this.pairing, seen: map(this.pairing.seen) };
  }

  shutdown(): void {
    this.connections.forEach((connection) => {
      connection.close("Central system shutting down");
    });
    this.connections.clear();
  }

  remoteStart(chargePointId: string, amps?: number): Promise<boolean> {
    return this.command(chargePointId, "RemoteStartTransaction", {
      connectorId: 1,
      idTag: "chargeha",
      ...(amps !== undefined && {
        chargingProfile: remoteStartTxProfile(amps),
      }),
    });
  }

  remoteStop(chargePointId: string): Promise<boolean> {
    const transactionId = this.getData(chargePointId).transactionId;
    if (transactionId === null) return this.suspendCharging(chargePointId);
    return this.command(chargePointId, "RemoteStopTransaction", {
      transactionId,
    });
  }

  private async command(
    chargePointId: string,
    action: string,
    payload: unknown,
  ): Promise<boolean> {
    const res = await this.send(chargePointId, action, payload);
    const accepted = isAccepted(res);
    this.logOutcome(chargePointId, action, accepted, res);
    if (!accepted) {
      throw new Error(
        `${action} not accepted: ${resultStatus(res)}${
          this.chargerContext(chargePointId)
        }`,
      );
    }
    return true;
  }

  // Rare and user- or controller-triggered, so info/warn is safe volume.
  private logOutcome(
    chargePointId: string,
    action: string,
    accepted: boolean,
    res: unknown,
  ): void {
    const payload = { chargePointId, action, result: res };
    if (accepted) {
      this.dbLog.info(`${action} accepted (${chargePointId})`, { payload });
    } else {
      this.dbLog.warn(`${action} rejected (${chargePointId})`, { payload });
    }
  }

  // No transaction id to stop with (reconnect after a restart): cap the draw
  // at 0 A rather than fail, and a later setChargeAmps lifts it.
  private async suspendCharging(chargePointId: string): Promise<boolean> {
    this.logger.warn(
      `No transaction id for ${chargePointId}; suspending via a 0A ` +
        "ChargePointMaxProfile instead of RemoteStopTransaction",
    );
    const res = await this.send(
      chargePointId,
      "SetChargingProfile",
      chargingProfilePayload("ChargePointMaxProfile", 0).payload,
    );
    return isAccepted(res);
  }

  async setChargingProfiles(
    chargePointId: string,
    profiles: ChargingProfileRequest[],
  ): Promise<boolean> {
    const results: unknown[] = [];
    for (const p of profiles) {
      results.push(
        await this.send(chargePointId, "SetChargingProfile", p.payload),
      );
    }
    const rejected = profiles.filter((_, i) => !isAccepted(results[i]));
    // A rejected TxProfile is advisory when the authoritative tiers landed:
    // ChargePointMax + TxDefault already steer the charger.
    const fatal = rejected.filter((p) => p.purpose !== "TxProfile");
    this.logOutcome(
      chargePointId,
      "SetChargingProfile",
      rejected.length === 0,
      results,
    );
    if (fatal.length > 0) {
      const detail = profiles
        .map((p, i) => `${p.purpose}=${resultStatus(results[i])}`)
        .join(", ");
      throw new Error(
        `SetChargingProfile not accepted: ${detail}${
          this.chargerContext(chargePointId)
        }`,
      );
    }
    return true;
  }

  // User-triggered escape hatch from a disordered state: forget any cached
  // transaction, wipe stored profiles (including a standing 0A clamp), and
  // ask the charger to restate the truth.
  async recoverConnection(chargePointId: string): Promise<string[]> {
    const steps: string[] = [];
    this.patch(chargePointId, {
      transactionId: null,
      meterStartWh: null,
      lastMeterValuesAt: null,
    });
    steps.push("cleared cached transaction state");
    // Best-effort per step: TriggerMessage is an optional feature profile and
    // a NotImplemented reply must not abort the rest of the recovery.
    for (
      const [label, action, payload] of [
        ["cleared charging profiles", "ClearChargingProfile", {}],
        ["requested status", "TriggerMessage", {
          requestedMessage: "StatusNotification",
          connectorId: 1,
        }],
        ["requested meter values", "TriggerMessage", {
          requestedMessage: "MeterValues",
          connectorId: 1,
        }],
      ] as const
    ) {
      try {
        const res = await this.send(chargePointId, action, payload);
        steps.push(`${label}: ${resultStatus(res)}`);
      } catch (error) {
        steps.push(`${label}: failed (${error})`);
      }
    }
    this.dbLog.info(`Connection recovery (${chargePointId})`, {
      payload: { chargePointId, steps },
    });
    return steps;
  }

  // Remote equivalent of the isolation switch.
  softReset(chargePointId: string): Promise<boolean> {
    return this.command(chargePointId, "Reset", { type: "Soft" });
  }

  private chargerContext(chargePointId: string): string {
    const data = this.getData(chargePointId);
    if (data.status === null) return "";
    if (data.errorCode === null || data.errorCode === "NoError") {
      return ` (charger status ${data.status})`;
    }
    const vendor = data.vendorErrorCode !== null
      ? `/${data.vendorErrorCode}`
      : "";
    const info = data.statusInfo !== null ? `: ${data.statusInfo}` : "";
    return ` (charger status ${data.status} ${data.errorCode}${vendor}${info})`;
  }

  // GetConfiguration round trip: proves the charger answers calls.
  async ping(chargePointId: string): Promise<{ latencyMs: number }> {
    const startedAt = performance.now();
    await this.send(chargePointId, "GetConfiguration", {
      key: ["HeartbeatInterval"],
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    // User-triggered (testConnection), not a poll — safe at debug.
    this.dbLog.debug(`Ping round trip (${chargePointId})`, {
      payload: { chargePointId, latencyMs },
    });
    return { latencyMs };
  }

  private onMessage(chargePointId: string, raw: string): void {
    const connection = this.connections.get(chargePointId);
    if (connection === undefined) return;
    const frame = this.decode(raw);
    if (frame === null) return;
    // Must stay synchronous and above the queue: a queued handler can be
    // mid-send() awaiting this very reply, so queueing it deadlocks.
    if (connection.settle(frame)) return;
    if (frame.kind !== "call") return;
    this.queueCall(chargePointId, connection, frame);
  }

  private decode(raw: string): OcppFrame | null {
    try {
      return OcppFraming.decode(raw);
    } catch (error) {
      this.logger.warn(`Bad OCPP message dropped: ${error}`);
      return null;
    }
  }

  private queueCall(
    chargePointId: string,
    connection: OcppConnection,
    frame: OcppFrame & { kind: "call" },
  ): void {
    const queued = connection.enqueue(() =>
      this.reply(chargePointId, connection, frame)
    );
    if (queued) return;
    // The charger already hung up, so there is nobody to read a CALLERROR.
    if (connection.isStopped) return;
    // Bounded, not dropped: chargers retry a CALLERROR, so this is recoverable
    // in a way a silent drop is not.
    connection.sendRaw(
      OcppFraming.error(
        frame.id,
        "InternalError",
        `Too many pending messages for ${chargePointId}`,
      ),
    );
  }

  private async reply(
    chargePointId: string,
    connection: OcppConnection,
    frame: OcppFrame & { kind: "call" },
  ): Promise<void> {
    try {
      const payload = await this.resolveAction(
        chargePointId,
        frame.action,
        frame.payload,
      );
      const message = payload === null
        ? OcppFraming.error(frame.id, "NotImplemented", frame.action)
        : OcppFraming.result(frame.id, payload);
      connection.sendRaw(message);
      // Never before: a charge point need not answer our CALLs until we have
      // accepted its BootNotification.
      if (frame.action === "BootNotification") {
        void this.afterBoot(chargePointId);
      }
    } catch (error) {
      // OCPP-J: a bad payload still gets a targeted CALLERROR, never a silent
      // drop that leaves the charger waiting on its timeout.
      this.logger.warn(`OCPP ${frame.action} payload rejected: ${error}`);
      connection.sendRaw(
        OcppFraming.error(frame.id, "FormationViolation", String(error)),
      );
    }
  }

  // Gated on the charger row: pushing config into a charger the user may still
  // discard is not ours to do.
  private async afterBoot(chargePointId: string): Promise<void> {
    if (!(await this.hasChargerRow(chargePointId))) return;
    await this.negotiator.negotiate(chargePointId);
    await this.maxAmpsDetector.detect(chargePointId);
  }

  detectedMaxAmps(chargePointId: string): number | null {
    return this.maxAmpsDetector.detectedMaxAmps(chargePointId);
  }

  // Evidence-based, so a false "Accepted" is caught but idle silence is not.
  measurandWarning(chargePointId: string): string | null {
    return measurandWarningFor(
      this.negotiator.outcome(chargePointId),
      this.getData(chargePointId),
    );
  }

  // An id with no charger row is refused, except BootNotification: needed to
  // display vendor/model during pairing.
  private async resolveAction(
    chargePointId: string,
    action: string,
    payload: unknown,
  ): Promise<unknown | null> {
    if (
      action !== "BootNotification" &&
      !(await this.hasChargerRow(chargePointId))
    ) {
      this.logger.warn(
        `OCPP ${action} refused: no charger row for ${chargePointId}`,
      );
      this.dbLog.warn(`${action} refused, no charger row (${chargePointId})`, {
        payload: { chargePointId, action },
      });
      return null;
    }
    return this.handleAction(chargePointId, action, payload);
  }

  // Returns the CALLRESULT payload, or null for unsupported actions.
  private handleAction(
    chargePointId: string,
    action: string,
    payload: unknown,
  ): unknown | null {
    // PluginDbLogger only scopes by plugin id — chargePointId distinguishes
    // two OCPP chargers in the log table.
    this.dbLog.debug(`← ${action} (${chargePointId})`, {
      payload: { chargePointId, raw: payload },
    });
    switch (action) {
      case "BootNotification": {
        const boot = bootNotificationReq.parse(payload);
        const info = {
          vendor: boot.chargePointVendor,
          model: boot.chargePointModel,
          firmwareVersion: boot.firmwareVersion ?? "unknown",
        };
        this.patch(chargePointId, { info });
        // So the panel can name a charger that turned up before adoption.
        this.updateSeen((seen) =>
          seen.map((c) => c.chargerId === chargePointId ? { ...c, info } : c)
        );
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
        this.patch(chargePointId, {
          status: s.status,
          errorCode: s.errorCode,
          statusInfo: s.info ?? null,
          vendorErrorCode: s.vendorErrorCode ?? null,
        });
        return {};
      }
      case "MeterValues": {
        const mv = meterValuesReq.parse(payload);
        const readings = this.readMeterValues(chargePointId, mv);
        this.patch(chargePointId, {
          ...this.adoptTransaction(
            chargePointId,
            mv.transactionId,
            readings.energyRegisterWh ?? null,
          ),
          ...readings,
          lastMeterValuesAt: Date.now(),
        });
        return {};
      }
      case "StartTransaction": {
        const start = startTransactionReq.parse(payload);
        const connection = this.connections.get(chargePointId);
        if (connection === undefined) return null;
        const transactionId = connection.nextTransactionId();
        this.patch(chargePointId, {
          transactionId,
          meterStartWh: start.meterStart,
        });
        return {
          transactionId,
          idTagInfo: { status: "Accepted" },
        };
      }
      case "StopTransaction": {
        const stop = stopTransactionReq.safeParse(payload);
        const connection = this.connections.get(chargePointId);
        if (stop.success && connection !== undefined) {
          connection.noteStoppedTransaction(stop.data.transactionId);
          const current = connection.getData().transactionId;
          // A replayed offline stop for an old transaction must not kill the
          // current one.
          if (current !== null && current !== stop.data.transactionId) {
            return { idTagInfo: { status: "Accepted" } };
          }
        }
        this.patch(chargePointId, {
          transactionId: null,
          meterStartWh: null,
          lastMeterValuesAt: null,
        });
        return { idTagInfo: { status: "Accepted" } };
      }
      case "Authorize":
        authorizeReq.parse(payload);
        return { idTagInfo: { status: "Accepted" } };
      default:
        return null;
    }
  }

  // Chargers send `transactionId` on every in-transaction MeterValues, so a
  // reconnect after a restart regains stop-control within a minute, not never.
  private adoptTransaction(
    chargePointId: string,
    transactionId: number | undefined,
    energyRegisterWh: number | null,
  ): Partial<OcppLiveData> {
    if (transactionId === undefined) return {};
    const connection = this.connections.get(chargePointId);
    if (connection === undefined) return {};
    // Chargers flush 1-2 final MeterValues after StopTransaction; adopting
    // that id resurrects a dead transaction (the 22 Aug incident).
    if (connection.hasStoppedTransaction(transactionId)) return {};
    const data = connection.getData();
    if (data.status === "Finishing" || data.status === "Available") return {};
    if (data.transactionId === transactionId) return {};
    connection.reserveTransactionId(transactionId);
    // Once per reconnect that lost its StartTransaction, not per MeterValues.
    this.dbLog.info(`Adopted transaction ${transactionId} (${chargePointId})`, {
      payload: { chargePointId, transactionId },
    });
    return {
      transactionId,
      // A real StartTransaction baseline must never be overwritten.
      meterStartWh: data.meterStartWh ?? energyRegisterWh,
    };
  }

  private readMeterValues(
    chargePointId: string,
    mv: ReturnType<typeof meterValuesReq.parse>,
  ): Partial<OcppLiveData> {
    return readMeterValueFields(
      mv,
      (registerWh) => this.derivePowerFromRegister(chargePointId, registerWh),
    );
  }

  // (ΔWh × 3600) / Δseconds. The first reading after boot yields null, as does
  // a negative delta (register reset) rather than a guess.
  private derivePowerFromRegister(
    chargePointId: string,
    registerWh: number | null,
  ): number | null {
    const previous = this.getData(chargePointId);
    const prevWh = previous.energyRegisterWh;
    const prevAt = previous.lastMeterValuesAt;
    if (registerWh === null || prevWh === null || prevAt === null) return null;
    const elapsedSec = (Date.now() - prevAt) / 1000;
    if (elapsedSec <= 0) return null;
    const deltaWh = registerWh - prevWh;
    if (deltaWh < 0) return null;
    return (deltaWh * 3600) / elapsedSec;
  }

  private onClose(chargePointId: string, socket: WebSocket): void {
    const connection = this.connections.get(chargePointId);
    // A reconnect already replaced this entry — the old socket closing must
    // not tear down the new one.
    if (connection === undefined || connection.socket !== socket) return;
    connection.close("Charger disconnected");
    this.connections.delete(chargePointId);
    this.logger.warn(`Charger ${chargePointId} disconnected`);
    this.dbLog.warn(`Charger ${chargePointId} disconnected`, {
      payload: { chargePointId },
    });
  }

  private async send(
    chargePointId: string,
    action: string,
    payload: unknown,
  ): Promise<unknown> {
    const connection = this.connections.get(chargePointId);
    if (connection === undefined) {
      throw new Error(`Charger ${chargePointId} not connected`);
    }
    return await connection.send(action, payload);
  }

  private patch(chargePointId: string, delta: Partial<OcppLiveData>): void {
    this.connections.get(chargePointId)?.patch(delta);
  }
}

function resultStatus(res: unknown): string {
  if (typeof res === "object" && res !== null && "status" in res) {
    return String((res as { status: unknown }).status);
  }
  return "no status in response";
}

function isAccepted(res: unknown): boolean {
  return typeof res === "object" && res !== null &&
    (res as { status?: string }).status === "Accepted";
}
