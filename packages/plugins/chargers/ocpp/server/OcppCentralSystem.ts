import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { type OcppFrame, OcppFraming, PendingCalls } from "./OcppFraming.ts";
import {
  authorizeReq,
  bootNotificationReq,
  type ChargePointStatus,
  chargingProfilePayload,
  meterValuesReq,
  type SampledValue,
  startTransactionReq,
  statusNotificationReq,
} from "./OcppMessages.ts";
import { measurandWarningFor } from "./OcppMeasurands.ts";
import { OcppMeasurandNegotiator } from "./OcppMeasurandNegotiator.ts";

export interface OcppChargerInfo {
  vendor: string;
  model: string;
  firmwareVersion: string;
}

/** One charger that turned up during a pairing window. More than one can:
 *  a household may have two, or an old id may still be retrying alongside a
 *  new one, so the user picks rather than us guessing. */
export interface OcppSeenCharger {
  chargerId: string;
  info: OcppChargerInfo | null;
  at: number;
}

export interface OcppPairingState {
  armed: boolean;
  expiresAt: number | null;
  /** Most recent arrival — kept for the single-charger case. */
  announcedId: string | null;
  info: OcppChargerInfo | null;
  /** Everything that connected during this window, newest last. */
  seen: OcppSeenCharger[];
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
  /** Sum of the per-phase currents, when the charger reported them per
   *  phase. null when it reported a single unphased current — the adapter
   *  then scales by the configured phase count instead. Kept alongside the
   *  average because the adapter reads only this cache; parsing measurands
   *  there would break the push-based boundary. */
  currentSumA: number | null;
  voltageV: number | null;
  energyRegisterWh: number | null;
  lastMeterValuesAt: number | null;
  lastUpdated: string;
}

/** A socket that reached us without a charge point id — should not happen,
 *  but keys the map rather than silently sharing one entry. */
const UNKNOWN_CHARGER = "";

const idlePairing = (): OcppPairingState => ({
  armed: false,
  expiresAt: null,
  announcedId: null,
  info: null,
  seen: [],
});

/** Add a charger to the seen list, or refresh the one already there. Chargers
 *  reconnect often; a duplicate row per reconnect would be noise. */
function withCharger(
  seen: OcppSeenCharger[],
  chargerId: string,
): OcppSeenCharger[] {
  const known = seen.some((c) => c.chargerId === chargerId);
  if (!known) return [...seen, { chargerId, info: null, at: Date.now() }];
  return seen.map((c) =>
    c.chargerId === chargerId ? { ...c, at: Date.now() } : c
  );
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
  currentSumA: null,
  voltageV: null,
  energyRegisterWh: null,
  lastMeterValuesAt: null,
  lastUpdated: new Date().toISOString(),
});

/** Everything that belongs to one charge point's live socket. Previously
 *  these were single fields on the class, which is why a second charger
 *  evicted the first and why both would have shared a transaction counter. */
interface OcppConnection {
  socket: WebSocket;
  data: OcppLiveData;
  /** Per socket: a CALLRESULT from one charger must never settle a call sent
   *  to another. */
  pending: PendingCalls;
  transactionCounter: number;
}

/** A central system bound to one charge point. Adapters take this rather than
 *  the whole central system, so an adapter cannot command a charger other than
 *  its own, and cannot reach plugin-wide operations like pairing. */
export interface OcppChargerHandle {
  getData(): OcppLiveData;
  remoteStart(): Promise<boolean>;
  remoteStop(): Promise<boolean>;
  setChargingProfiles(payloads: Array<Record<string, unknown>>): Promise<
    boolean
  >;
  ping(): Promise<{ latencyMs: number }>;
}

/** Plugin-internal OCPP 1.6J central system for a single charger.
 *  Owns the live socket, answers charger-initiated CALLs, tracks pushed
 *  state, and sends our CALLs (RemoteStart/Stop, SetChargingProfile...). */
export class OcppCentralSystem {
  private readonly connections = new Map<string, OcppConnection>();
  private pairing: OcppPairingState = idlePairing();
  /** Last charger turned away for an unknown id, and when. A charger set up
   *  before listening started retries every couple of seconds; that is a
   *  signal worth showing the user, not noise to bury in the log. */
  private knocking: { chargerId: string; at: number } | null = null;
  /** Owned here rather than per connection: the reconnect it has to survive
   *  destroys the connection object. */
  private readonly negotiator: OcppMeasurandNegotiator;

  constructor(
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
    /** The honest source of truth for whether a charge point id may act: does
     *  any charger row exist for it? Async because it is a DB-backed lookup —
     *  saving a row must take effect on an already-open socket's very next
     *  message, with no reconnect. */
    private readonly hasChargerRow: (chargePointId: string) => Promise<boolean>,
  ) {
    this.negotiator = new OcppMeasurandNegotiator(
      (id, action, payload) => this.send(id, action, payload),
      logger,
      dbLog,
    );
  }

  /** Disconnected chargers report fresh state rather than nothing, so callers
   *  never have to special-case "no connection yet". */
  getData(chargePointId: string): OcppLiveData {
    return this.connections.get(chargePointId)?.data ?? freshData();
  }

  // ── Pairing ──────────────────────────────────────────────────────────

  /** Open a time-boxed window in which a charger announcing any id may
   *  connect provisionally. Lets the panel prove reachability before the user
   *  commits a charger id, which otherwise cannot happen: the socket is
   *  rejected until an id is saved, and the id cannot be verified until a
   *  socket arrives. */
  armPairing(ttlMs: number): void {
    // Re-arming must not forget a charger that is already paired. The panel
    // re-arms from polled state that can be a couple of seconds stale, so a
    // reset here would blank the "found" display and make it flicker.
    this.pairing = {
      armed: true,
      expiresAt: Date.now() + ttlMs,
      // Keep across a renewal — the panel renews every minute while open, and
      // forgetting what was found would empty the picker.
      announcedId: this.pairing.armed ? this.pairing.announcedId : null,
      info: this.pairing.armed ? this.pairing.info : null,
      seen: this.pairing.armed ? this.pairing.seen : [],
    };
    this.logger.info(`OCPP pairing armed for ${Math.round(ttlMs / 1000)}s`);
  }

  /** Sockets tolerated only because pairing was open must not outlive it. A
   *  connection whose charge point id now has a charger row is adopted and
   *  left alone; everything else is a pairing-only socket. */
  async cancelPairing(): Promise<void> {
    this.pairing = idlePairing();
    await Promise.all(
      [...this.connections.entries()].map(async ([id, connection]) => {
        if (!(await this.hasChargerRow(id))) connection.socket.close();
      }),
    );
  }

  /** Expired windows report themselves closed without needing a timer. */
  pairingState(): OcppPairingState {
    if (!this.pairing.armed) return this.pairing;
    if (
      this.pairing.expiresAt !== null && Date.now() > this.pairing.expiresAt
    ) {
      return idlePairing();
    }
    return this.pairing;
  }

  /** wsRoutes gate: may a charger whose id is not the configured one connect
   *  right now? */
  acceptsPairing(): boolean {
    return this.pairingState().armed;
  }

  /** Adopt an upgraded socket (from wsRoutes). A reconnect replaces the old
   *  socket; state is retained (PRD: reconnection restores state). Whether
   *  this id may act beyond BootNotification is decided fresh on every
   *  message via `hasChargerRow`, not cached here — so once Save creates the
   *  row, this same socket's next message is handled normally. */
  attach(socket: WebSocket, opts: { chargerId?: string } = {}): void {
    const id = opts.chargerId ?? UNKNOWN_CHARGER;
    // Close only the previous socket for THIS charge point — that is a
    // reconnect. A different id is a different charger and must be left
    // alone; closing it is what made a second charger evict the first.
    this.connections.get(id)?.socket.close();
    const connection: OcppConnection = {
      socket,
      data: { ...freshData(), connected: true },
      pending: new PendingCalls(),
      transactionCounter: 0,
    };
    this.connections.set(id, connection);
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onmessage = (event) => this.onMessage(id, String(event.data));
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onclose = () => this.onClose(id, socket);
    // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- WebSocket handler wiring
    socket.onerror = (event) => this.logger.warn(`OCPP socket error: ${event}`);
    this.logger.info(`Charger ${id} connected`);
  }

  /** A bound view for one charge point. Adapters take this so they cannot
   *  command another charger, nor reach plugin-wide operations. */
  forCharger(chargePointId: string): OcppChargerHandle {
    return {
      getData: () => this.getData(chargePointId),
      remoteStart: () => this.remoteStart(chargePointId),
      remoteStop: () => this.remoteStop(chargePointId),
      setChargingProfiles: (payloads) =>
        this.setChargingProfiles(chargePointId, payloads),
      ping: () => this.ping(chargePointId),
    };
  }

  /** A charger tried to connect but its id is not configured and no window is
   *  open. Recorded so the panel can offer to accept it. */
  noteRejected(chargerId: string): void {
    this.knocking = { chargerId, at: Date.now() };
  }

  /** Who has been knocking in the last 30 seconds, if anyone. */
  knockingCharger(): string | null {
    if (this.knocking === null) return null;
    return Date.now() - this.knocking.at < 30_000
      ? this.knocking.chargerId
      : null;
  }

  /** True the first time an id is turned away, then at most once a minute —
   *  a charger retrying on a 2s loop must not fill the log. */
  shouldLogRejection(chargerId: string): boolean {
    const last = this.knocking;
    return last === null || last.chargerId !== chargerId ||
      Date.now() - last.at > 60_000;
  }

  /** Record a charger that announced itself during the window. Re-announcing
   *  the same id updates its row rather than adding a duplicate — chargers
   *  reconnect frequently. */
  notePairedCharger(chargerId: string): void {
    if (!this.pairing.armed) return;
    this.pairing = {
      ...this.pairing,
      announcedId: chargerId,
      seen: withCharger(this.pairing.seen, chargerId),
    };
  }

  shutdown(): void {
    this.connections.forEach((connection) => {
      connection.pending.rejectAll("Central system shutting down");
      connection.socket.close();
    });
    this.connections.clear();
  }

  // ── Outgoing commands ────────────────────────────────────────────────

  async remoteStart(chargePointId: string): Promise<boolean> {
    const res = await this.send(chargePointId, "RemoteStartTransaction", {
      connectorId: 1,
      idTag: "chargeha",
    });
    const accepted = isAccepted(res);
    this.logOutcome(chargePointId, "RemoteStartTransaction", accepted, res);
    return accepted;
  }

  async remoteStop(chargePointId: string): Promise<boolean> {
    const transactionId = this.getData(chargePointId).transactionId;
    if (transactionId === null) return this.suspendCharging(chargePointId);
    const res = await this.send(chargePointId, "RemoteStopTransaction", {
      transactionId,
    });
    const accepted = isAccepted(res);
    this.logOutcome(chargePointId, "RemoteStopTransaction", accepted, res);
    return accepted;
  }

  /** Command outcomes (not the raw frame, already logged by `send`) — a
   *  rare, user- or controller-triggered event, so info/warn is safe volume. */
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

  /** No transaction id to stop with — a reconnect after a restart never got
   *  one via StartTransaction, and MeterValues has not adopted one yet.
   *  Cap the draw at 0 A instead of failing into the command backoff. The
   *  cap is lifted by the setChargeAmps that precedes any later start. */
  private async suspendCharging(chargePointId: string): Promise<boolean> {
    this.logger.warn(
      `No transaction id for ${chargePointId}; suspending via a 0A ` +
        "ChargePointMaxProfile instead of RemoteStopTransaction",
    );
    const res = await this.send(
      chargePointId,
      "SetChargingProfile",
      chargingProfilePayload("ChargePointMaxProfile", 0),
    );
    return isAccepted(res);
  }

  async setChargingProfiles(
    chargePointId: string,
    payloads: Array<Record<string, unknown>>,
  ): Promise<boolean> {
    const results = await Promise.all(
      payloads.map((p) => this.send(chargePointId, "SetChargingProfile", p)),
    );
    const accepted = results.every(isAccepted);
    this.logOutcome(chargePointId, "SetChargingProfile", accepted, results);
    return accepted;
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

  // ── Incoming ─────────────────────────────────────────────────────────

  private onMessage(chargePointId: string, raw: string): void {
    const connection = this.connections.get(chargePointId);
    if (connection === undefined) return;
    try {
      const frame = OcppFraming.decode(raw);
      if (connection.pending.settle(frame)) return;
      if (frame.kind !== "call") return;
      this.reply(chargePointId, frame);
    } catch (error) {
      this.logger.warn(`Bad OCPP message dropped: ${error}`);
    }
  }

  private async reply(
    chargePointId: string,
    frame: OcppFrame & { kind: "call" },
  ): Promise<void> {
    const socket = this.connections.get(chargePointId)?.socket;
    try {
      const payload = await this.resolveAction(
        chargePointId,
        frame.action,
        frame.payload,
      );
      const message = payload === null
        ? OcppFraming.error(frame.id, "NotImplemented", frame.action)
        : OcppFraming.result(frame.id, payload);
      socket?.send(message);
      // After the boot is answered, never before: a charge point is not
      // obliged to answer our CALLs until we have accepted its
      // BootNotification, and this is the first moment we have.
      if (frame.action === "BootNotification") {
        void this.afterBoot(chargePointId);
      }
    } catch (error) {
      // OCPP-J: a CALL with a bad payload still gets a targeted CALLERROR —
      // never a silent drop that leaves the charger waiting on its timeout.
      this.logger.warn(`OCPP ${frame.action} payload rejected: ${error}`);
      socket?.send(
        OcppFraming.error(frame.id, "FormationViolation", String(error)),
      );
    }
  }

  /** A saved charger has just booted. Negotiation is gated on the charger row
   *  because BootNotification is the one action `resolveAction` lets through
   *  without one: a pairing window accepts unknown chargers so the user can
   *  identify them, and pushing configuration into a charger the user may
   *  then discard is not ours to do. */
  private async afterBoot(chargePointId: string): Promise<void> {
    if (!(await this.hasChargerRow(chargePointId))) return;
    await this.negotiator.negotiate(chargePointId);
  }

  /** Why this charger's telemetry is degraded, or null. Read by the plugin's
   *  health check. Evidence-based: what the charger answered is checked
   *  against what has actually arrived since, so a charger that said
   *  Accepted and changed nothing is caught, and an idle charger sending
   *  nothing at all is not accused. */
  measurandWarning(chargePointId: string): string | null {
    return measurandWarningFor(
      this.negotiator.outcome(chargePointId),
      this.getData(chargePointId),
    );
  }

  /** Gates on the honest source of truth — a charger row — before handing off
   *  to `handleAction`. A message from an id with no row is refused, except
   *  BootNotification: needed to display vendor/model during pairing. */
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

  /** Returns the CALLRESULT payload, or null for unsupported actions. */
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
        // Surface vendor/model on the pairing state too, so the panel can
        // name the charger that turned up before it is adopted.
        if (this.pairing.armed) {
          this.pairing = {
            ...this.pairing,
            info,
            seen: this.pairing.seen.map((c) =>
              c.chargerId === chargePointId ? { ...c, info } : c
            ),
          };
        }
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
        this.patch(chargePointId, { status: s.status, errorCode: s.errorCode });
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
        connection.transactionCounter++;
        this.patch(chargePointId, {
          transactionId: connection.transactionCounter,
          meterStartWh: start.meterStart,
        });
        return {
          transactionId: connection.transactionCounter,
          idTagInfo: { status: "Accepted" },
        };
      }
      case "StopTransaction": {
        this.patch(chargePointId, { transactionId: null, meterStartWh: null });
        return { idTagInfo: { status: "Accepted" } };
      }
      case "Authorize":
        authorizeReq.parse(payload);
        return { idTagInfo: { status: "Accepted" } };
      default:
        return null;
    }
  }

  /** Adopt a transaction id carried on a MeterValues sample. OCPP 1.6
   *  chargers include `transactionId` on every in-transaction MeterValues
   *  (~once a minute), so a reconnect after a restart — which never gets a
   *  fresh StartTransaction — regains stop-control within a minute instead
   *  of never. No-op when there is nothing to adopt: no id sent, no
   *  connection, or the live id already matches. */
  private adoptTransaction(
    chargePointId: string,
    transactionId: number | undefined,
    energyRegisterWh: number | null,
  ): Partial<OcppLiveData> {
    if (transactionId === undefined) return {};
    const connection = this.connections.get(chargePointId);
    if (connection === undefined) return {};
    if (connection.data.transactionId === transactionId) return {};
    // Keep the counter ahead so a later StartTransaction cannot hand back an
    // id the charger already considers in use.
    connection.transactionCounter = Math.max(
      connection.transactionCounter,
      transactionId,
    );
    this.logger.info(
      `Adopted transaction ${transactionId} for ${chargePointId} from MeterValues`,
    );
    // Once per reconnect that lost its StartTransaction, not per MeterValues.
    this.dbLog.info(`Adopted transaction ${transactionId} (${chargePointId})`, {
      payload: { chargePointId, transactionId },
    });
    return {
      transactionId,
      // A real StartTransaction baseline must never be overwritten — only
      // fall back to the current register reading when there is none.
      meterStartWh: connection.data.meterStartWh ?? energyRegisterWh,
    };
  }

  private readMeterValues(
    chargePointId: string,
    mv: ReturnType<typeof meterValuesReq.parse>,
  ): Partial<OcppLiveData> {
    const groups = groupSamples(
      mv.meterValue.flatMap((entry) => entry.sampledValue),
    );
    const power = readGroup(groups, "Power.Active.Import", aggregateAdditive);
    const current = readGroup(groups, "Current.Import", aggregateCurrent);
    const voltage = readGroup(groups, "Voltage", aggregateVoltage);
    const register = readGroup(
      groups,
      "Energy.Active.Import.Register",
      aggregateAdditive,
    );
    // The register carries its own unit, so it must be normalised the same
    // way power is — a kWh charger otherwise reads 1000x low. Normalisation
    // runs after aggregation: every phase of one measurand shares a unit,
    // so scaling the total once is both cheaper and lossless.
    const energyRegisterWh = register.value === null
      ? null
      : toWattHours(register.value, register.unit);
    // PRD fallback chain tier 2: no power measurand → derive from how fast
    // the register counts up. Tier 3 (current × voltage) stays in the
    // adapter for when neither power nor a register delta exists.
    const powerW = power.value === null
      ? this.derivePowerFromRegister(chargePointId, energyRegisterWh)
      : toWatts(power.value, power.unit);
    const currentFields = {
      currentA: current.value,
      currentSumA: currentSum(groups),
    };
    // A shielded reading omits its key rather than writing null, so a lone
    // neutral sample cannot wipe the good reading we already hold.
    return {
      ...(power.shielded ? {} : { powerW }),
      ...(current.shielded ? {} : currentFields),
      ...(voltage.shielded ? {} : { voltageV: voltage.value }),
      ...(register.shielded ? {} : { energyRegisterWh }),
    };
  }

  /** Watts from successive register readings: (ΔWh × 3600) / Δseconds.
   *  Needs two readings — the first after boot/reconnect yields null; a
   *  negative delta (register reset) yields null rather than a guess. */
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
    connection.pending.rejectAll("Charger disconnected");
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
    if (
      connection === undefined ||
      connection.socket.readyState !== WebSocket.OPEN
    ) {
      throw new Error(`Charger ${chargePointId} not connected`);
    }
    const id = crypto.randomUUID();
    this.dbLog.debug(`→ ${action} (${chargePointId})`, {
      payload: { chargePointId, raw: payload },
    });
    connection.socket.send(OcppFraming.call(id, action, payload));
    return await connection.pending.wait(id);
  }

  private patch(chargePointId: string, delta: Partial<OcppLiveData>): void {
    const connection = this.connections.get(chargePointId);
    if (connection === undefined) return;
    connection.data = {
      ...connection.data,
      ...delta,
      lastUpdated: new Date().toISOString(),
    };
  }
}

// ── Measurand aggregation ──────────────────────────────────────────────
// A 3-phase charger reports one sample per phase. Flattening those and
// taking the first match reads power at a third of actual, and can take a
// line-to-line voltage for a line-to-neutral one. Rules follow the HA OCPP
// integration's process_phases.

const PHASES_L123 = ["L1", "L2", "L3"] as const;
const PHASES_L_N = ["L1-N", "L2-N", "L3-N"] as const;
const PHASES_L_L = ["L1-L2", "L2-L3", "L3-L1"] as const;
const SQRT3 = Math.sqrt(3);

/** One sample, parsed. The finiteness check happens once, here, and nothing
 *  downstream re-parses. */
interface ParsedSample {
  value: number;
  phase: string | undefined;
  unit: string | undefined;
}

/** One measurand's samples. `total` is the sample that carried no `phase`
 *  field; `phases` is keyed by the raw OCPP phase label. */
interface MeasurandGroup {
  unit: string | undefined;
  total: number | null;
  phases: Map<string, number>;
}

/** What a measurand resolved to. `shielded` means "do not write this key" —
 *  the payload said nothing about the installation and must not disturb
 *  what we already hold. */
interface Reading {
  value: number | null;
  unit: string | undefined;
  shielded: boolean;
}

const NO_READING: Reading = { value: null, unit: undefined, shielded: false };

/** An absent measurand means Energy.Active.Import.Register (OCPP 1.6). */
const measurandOf = (sample: SampledValue): string =>
  sample.measurand ?? "Energy.Active.Import.Register";

function groupSamples(samples: SampledValue[]): Map<string, MeasurandGroup> {
  const names = [...new Set(samples.map(measurandOf))];
  return new Map(
    names.map((name) => [
      name,
      buildGroup(samples.filter((s) => measurandOf(s) === name)),
    ]),
  );
}

function buildGroup(samples: SampledValue[]): MeasurandGroup {
  // A value that will not parse is dropped outright. Letting it through as
  // NaN would poison the sum and take its healthy sibling phases with it.
  const usable = samples.flatMap((s): ParsedSample[] => {
    const value = parseFloat(s.value);
    return Number.isFinite(value)
      ? [{ value, phase: s.phase, unit: s.unit }]
      : [];
  });
  const unphased = usable.filter((s) => s.phase === undefined);
  return {
    unit: usable.at(-1)?.unit,
    // Last wins. A batched MeterValues carries several meterValue entries
    // oldest first, so the tail is the freshest reading — which is also
    // what the Map below does for repeated phase labels.
    total: unphased.at(-1)?.value ?? null,
    phases: new Map(
      usable.flatMap((s) =>
        s.phase === undefined ? [] : [[s.phase, s.value] as const]
      ),
    ),
  };
}

/** The values actually present for these phase labels. An absent phase is
 *  dropped everywhere; a zero survives here and is dropped only by
 *  averaging. */
const valuesFor = (
  group: MeasurandGroup,
  phases: readonly string[],
): number[] =>
  phases.flatMap((phase) => {
    const value = group.phases.get(phase);
    return value === undefined ? [] : [value];
  });

/** Average over the non-zero entries. Amps are the control quantity: a
 *  charger limited to 16 A draws 16 A on each ACTIVE phase, so 16/16/0 is
 *  16, not 10.67 — averaging an idle phase's zero would report headroom
 *  that does not exist. All-zero is still a reading, so it returns 0. */
function averageNonZero(values: number[]): number | null {
  if (values.length === 0) return null;
  const nonZero = values.filter((value) => value !== 0);
  if (nonZero.length === 0) return 0;
  return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
}

const sumOf = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0);

/** The per-phase current set: L1/L2/L3, ignoring N. Some chargers misuse
 *  the line-to-neutral labels for current, so those are the fallback. One
 *  selector serves both the average and the sum, so the two can never
 *  disagree about which set they read. */
function currentPhaseValues(group: MeasurandGroup): number[] {
  const line = valuesFor(group, PHASES_L123);
  return line.length > 0 ? line : valuesFor(group, PHASES_L_N);
}

const aggregateCurrent = (group: MeasurandGroup): number | null =>
  averageNonZero(currentPhaseValues(group));

/** Power.* and Energy.*: the installation total is the sum of its phases. */
function aggregateAdditive(group: MeasurandGroup): number | null {
  const line = valuesFor(group, PHASES_L123);
  if (line.length > 0) return sumOf(line);
  return sumOf(valuesFor(group, PHASES_L_N));
}

function aggregateVoltage(group: MeasurandGroup): number | null {
  const neutral = valuesFor(group, PHASES_L_N);
  if (neutral.length > 0) return averageNonZero(neutral);
  const lineToLine = averageNonZero(valuesFor(group, PHASES_L_L));
  // Line-to-line is √3 larger than line-to-neutral for the same supply;
  // everything downstream assumes line-to-neutral.
  if (lineToLine !== null) return lineToLine / SQRT3;
  // Workaround for chargers that label line-to-neutral volts as bare
  // L1/L2/L3, against engineering convention.
  return averageNonZero(valuesFor(group, PHASES_L123));
}

/** A measurand whose only phase is N. Skipped entirely: a lone neutral
 *  sample is not a reading of the installation, and must not be taken as
 *  one nor allowed to overwrite the reading we already have. */
const neutralOnly = (group: MeasurandGroup): boolean =>
  group.phases.size > 0 &&
  [...group.phases.keys()].every((phase) => phase === "N");

function readGroup(
  groups: Map<string, MeasurandGroup>,
  measurand: string,
  aggregate: (group: MeasurandGroup) => number | null,
): Reading {
  const group = groups.get(measurand);
  if (group === undefined) return NO_READING;
  if (neutralOnly(group)) {
    return { value: null, unit: group.unit, shielded: true };
  }
  // An unphased sample wins over per-phase entries for the same measurand.
  // Chargers exist that send both a total and its phases, and counting both
  // double-counts. Inferred from field behaviour, not stated by OCPP 1.6.
  return {
    value: group.total ?? aggregate(group),
    unit: group.unit,
    shielded: false,
  };
}

/** Sum of the per-phase currents, for the adapter's tier-3 power
 *  derivation. null when the charger reported a single unphased current:
 *  there is nothing to sum, and the adapter must scale by the configured
 *  phase count instead. */
function currentSum(groups: Map<string, MeasurandGroup>): number | null {
  const group = groups.get("Current.Import");
  if (group === undefined || group.total !== null) return null;
  if (neutralOnly(group)) return null;
  return sumOf(currentPhaseValues(group));
}

function isAccepted(res: unknown): boolean {
  return typeof res === "object" && res !== null &&
    (res as { status?: string }).status === "Accepted";
}

/** OCPP allows Power.Active.Import in W (default) or kW. */
function toWatts(value: number, unit: string | undefined): number {
  return unit === "kW" ? value * 1000 : value;
}

/** OCPP allows Energy.Active.Import.Register in Wh (default) or kWh. */
function toWattHours(value: number, unit: string | undefined): number {
  return unit === "kWh" ? value * 1000 : value;
}
