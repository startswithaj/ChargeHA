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

/** A charger that reached us during a pairing window but whose id is not the
 *  configured one yet. Reported so the panel can show what turned up and
 *  offer to adopt it. */
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
  /** True while the live socket is a pairing connection: proven reachable but
   *  not yet adopted, so it must not drive charging or write any state. */
  provisional: boolean;
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

/** Charger-initiated actions a provisional connection may use. Enough to
 *  prove the charger is real and reachable and to show what it is; everything
 *  else is refused until the user adopts it, so an unadopted charger can never
 *  open a transaction or write meter state. */
const PAIRING_ACTIONS = new Set([
  "BootNotification",
  "Heartbeat",
  "StatusNotification",
]);

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
  provisional: false,
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
  restoreTransaction(tx: ActiveTransaction): void;
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

  constructor(
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
    /** Persists the active transaction (null = cleared) so a mid-charge
     *  restart keeps stop-control. Failures are logged, never thrown. */
    /** Scoped by charge point id so a mid-charge restart restores each
     *  charger's own session rather than one shared row. */
    private readonly persistTransaction: (
      chargePointId: string,
      tx: ActiveTransaction | null,
    ) => Promise<void>,
  ) {}

  /** Disconnected chargers report fresh state rather than nothing, so callers
   *  never have to special-case "no connection yet". */
  getData(chargePointId: string): OcppLiveData {
    return this.connections.get(chargePointId)?.data ?? freshData();
  }

  /** Seed a persisted mid-charge transaction on boot. No-op once live. */
  restoreTransaction(chargePointId: string, tx: ActiveTransaction): void {
    const connection = this.connections.get(chargePointId);
    if (connection === undefined) return;
    if (connection.data.transactionId !== null) return;
    connection.transactionCounter = tx.transactionId;
    this.patch(chargePointId, {
      transactionId: tx.transactionId,
      meterStartWh: tx.meterStartWh,
    });
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
      announcedId: this.hasProvisional() ? this.pairing.announcedId : null,
      info: this.hasProvisional() ? this.pairing.info : null,
      // Keep the list across a renewal — the panel renews every minute while
      // open, and forgetting what was found would empty the picker.
      seen: this.pairing.armed ? this.pairing.seen : [],
    };
    this.logger.info(`OCPP pairing armed for ${Math.round(ttlMs / 1000)}s`);
  }

  cancelPairing(): void {
    this.pairing = idlePairing();
    // Sockets tolerated only because pairing was open must not outlive it.
    // An adopted charger's connection is untouched.
    this.connections.forEach((connection) => {
      if (connection.data.provisional) connection.socket.close();
    });
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

  /** The user adopted the paired charger, so the live socket graduates to a
   *  full connection — no reconnect wait. */
  promotePairing(): void {
    this.pairing = idlePairing();
    this.connections.forEach((connection, id) => {
      if (connection.data.provisional) this.patch(id, { provisional: false });
    });
  }

  /** Any connection still awaiting adoption. */
  private hasProvisional(): boolean {
    return [...this.connections.values()].some((c) => c.data.provisional);
  }

  /** Adopt an upgraded socket (from wsRoutes). A reconnect replaces the old
   *  socket; state is retained (PRD: reconnection restores state).
   *  `provisional` marks a pairing connection — see OcppLiveData. */
  attach(
    socket: WebSocket,
    opts: { provisional?: boolean; chargerId?: string } = {},
  ): void {
    const id = opts.chargerId ?? UNKNOWN_CHARGER;
    // Close only the previous socket for THIS charge point — that is a
    // reconnect. A different id is a different charger and must be left
    // alone; closing it is what made a second charger evict the first.
    this.connections.get(id)?.socket.close();
    const connection: OcppConnection = {
      socket,
      data: {
        ...freshData(),
        connected: true,
        provisional: opts.provisional === true,
      },
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
    this.logger.info(
      opts.provisional
        ? `Charger ${id} connected (pairing)`
        : `Charger ${id} connected`,
    );
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
      restoreTransaction: (tx) => this.restoreTransaction(chargePointId, tx),
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
    return isAccepted(res);
  }

  async remoteStop(chargePointId: string): Promise<boolean> {
    const transactionId = this.getData(chargePointId).transactionId;
    if (transactionId === null) return false;
    const res = await this.send(chargePointId, "RemoteStopTransaction", {
      transactionId,
    });
    return isAccepted(res);
  }

  async setChargingProfiles(
    chargePointId: string,
    payloads: Array<Record<string, unknown>>,
  ): Promise<boolean> {
    const results = await Promise.all(
      payloads.map((p) => this.send(chargePointId, "SetChargingProfile", p)),
    );
    return results.every(isAccepted);
  }

  // GetConfiguration round trip: proves the charger answers calls.
  async ping(chargePointId: string): Promise<{ latencyMs: number }> {
    const startedAt = performance.now();
    await this.send(chargePointId, "GetConfiguration", {
      key: ["HeartbeatInterval"],
    });
    return { latencyMs: Math.round(performance.now() - startedAt) };
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

  private reply(
    chargePointId: string,
    frame: OcppFrame & { kind: "call" },
  ): void {
    const socket = this.connections.get(chargePointId)?.socket;
    try {
      const payload = this.handleAction(
        chargePointId,
        frame.action,
        frame.payload,
      );
      const message = payload === null
        ? OcppFraming.error(frame.id, "NotImplemented", frame.action)
        : OcppFraming.result(frame.id, payload);
      socket?.send(message);
    } catch (error) {
      // OCPP-J: a CALL with a bad payload still gets a targeted CALLERROR —
      // never a silent drop that leaves the charger waiting on its timeout.
      this.logger.warn(`OCPP ${frame.action} payload rejected: ${error}`);
      socket?.send(
        OcppFraming.error(frame.id, "FormationViolation", String(error)),
      );
    }
  }

  /** Returns the CALLRESULT payload, or null for unsupported actions. */
  private handleAction(
    chargePointId: string,
    action: string,
    payload: unknown,
  ): unknown | null {
    this.dbLog.debug(`← ${action}`, { payload: { raw: payload } });
    // An unadopted charger gets a NotImplemented CALLERROR for anything
    // outside the pairing set — a targeted refusal rather than a silent drop,
    // and nothing it sends can reach the database.
    if (
      this.getData(chargePointId).provisional && !PAIRING_ACTIONS.has(action)
    ) {
      this.logger.warn(`OCPP ${action} refused: charger not adopted yet`);
      return null;
    }
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
        this.patch(chargePointId, {
          ...this.readMeterValues(
            chargePointId,
            meterValuesReq.parse(payload),
          ),
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
        this.persistTransaction(chargePointId, {
          transactionId: connection.transactionCounter,
          meterStartWh: start.meterStart,
        }).catch((error) =>
          this.logger.error("Persist transaction failed:", error)
        );
        return {
          transactionId: connection.transactionCounter,
          idTagInfo: { status: "Accepted" },
        };
      }
      case "StopTransaction": {
        this.patch(chargePointId, { transactionId: null, meterStartWh: null });
        this.persistTransaction(chargePointId, null).catch((error) =>
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
    chargePointId: string,
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
        ? this.derivePowerFromRegister(chargePointId, energyRegisterWh)
        : toWatts(rawPower, powerUnit),
      currentA: read("Current.Import"),
      voltageV: read("Voltage"),
      energyRegisterWh,
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
    this.dbLog.debug(`→ ${action}`, { payload: { raw: payload } });
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

function isAccepted(res: unknown): boolean {
  return typeof res === "object" && res !== null &&
    (res as { status?: string }).status === "Accepted";
}

/** OCPP allows Power.Active.Import in W (default) or kW. */
function toWatts(value: number, unit: string | undefined): number {
  return unit === "kW" ? value * 1000 : value;
}
