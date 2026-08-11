import type {
  CallContext,
  ChargerConfigMap,
  ChargerSecretsMap,
  ChargerState,
  ChargingPointMode,
  EnergyData,
  VehicleChargeState,
  VehicleResolutionKind,
} from "@chargeha/shared";
import { SolarAllocator } from "@chargeha/shared/engine";
import { linkedChargingPointId } from "@chargeha/shared/chargingPoints";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow, VehicleRow } from "../db/types.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { Logger } from "../lib/Logger.ts";
import type {
  ChargerMiddleware,
  ChargerPlugin,
} from "@chargeha/shared/plugins";
import type { ChargerPluginRegistry } from "../bootstrap/ChargerPluginRegistry.ts";
import { UnconfiguredChargerMiddleware } from "./UnconfiguredChargerMiddleware.ts";

const MAX_COMMAND_BACKOFF_SEC = 900;

const watts = (kw: number | null | undefined): number => (kw ?? 0) * 1000;

interface ChargerEntry {
  row: ChargerRow;
  middleware: ChargerMiddleware;
  lastEmittedAt: string | null;
  lastPluggedIn: boolean | null;
  lastResolved?: string | null;
  // What we last asked for — the engine compares against this, not the
  // measured draw, so a car taking fewer amps never triggers re-commands.
  lastCommandedAmps?: number | null;
  // Set when a passive point has been given its standing permission for the
  // current plug-in. Cleared on unplug and when control comes back.
  heldOpen?: boolean;
}

export interface VehicleResolution {
  kind: VehicleResolutionKind;
  vehicleId: string | null;
}

// Which side is deciding for this charging point right now. `"self"` — this point makes its own decisions: mode, schedules, solar tracking, amp adjustment.
// `"vehicle_api"` — the car on it is driven by its own API, so this point decides nothing. It is NOT unregistered: it still reports state, and it
// must still physically allow current or the car's API has no path to charge through. See `holdOpen`.
export interface ControlPath {
  owner: "self" | "vehicle_api";
  // The self-driven vehicle this point is passing current to.
  passiveForVehicleId: string | null;
}

interface CommandBackoffState {
  failures: number;
  backoffUntil: number | null;
}

export class ChargingPointManager {
  private chargers = new Map<string, ChargerEntry>();
  private commandBackoff = new Map<string, CommandBackoffState>();
  // Cached at init; enrich() runs on hot paths and must not hit the DB.
  private cachedGridVoltage: number | null = null;
  // Last good energy reading, cached from energy_update; cleared on a failed
  // poll so enrich() never resolves voltage from a zeroed breadcrumb.
  private latestEnergy: EnergyData | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly chargerPlugins: ChargerPluginRegistry,
    private readonly vehicleManager: VehicleManager,
    private readonly configService: ConfigService,
    private readonly eventEmitter: TypedEventEmitter,
    private readonly logger: Logger,
  ) {}

  async addCharger(row: ChargerRow): Promise<void> {
    if (this.chargers.has(row.id) || !row.active) return;
    const plugin = this.chargerPlugins.get(row.chargerAdapterType);
    if (!plugin) {
      this.logger.warn(
        `No charger plugin for type "${row.chargerAdapterType}", skipping ${row.id}`,
      );
      return;
    }
    // A misconfigured charger must not crash boot; retried on config change.
    const middleware = await this.tryCreateMiddleware(plugin, row);
    this.chargers.set(row.id, {
      row,
      middleware,
      lastEmittedAt: null,
      lastPluggedIn: null,
    });
    this.logger.info(`Charger registered: ${row.name} (${row.id})`);
    this.eventEmitter.emit("chargers_changed", {});
  }

  // Never throws: a charger whose adapter cannot be built still registers and reports "unconfigured", so the dashboard can say what is wrong.
  // Reading the row's config and secrets happens INSIDE the try. A row whose secrets were encrypted under an ENCRYPTION_KEY that is no longer set
  // makes `getChargerSecrets` throw; that must show up as one unconfigured charger on the dashboard, not as a failed boot.
  private async tryCreateMiddleware(
    plugin: ChargerPlugin,
    row: ChargerRow,
  ): Promise<ChargerMiddleware> {
    try {
      // The host reads storage so the plugin never has to — see
      // ChargerPlugin.createChargerMiddleware.
      const [config, secrets] = await Promise.all([
        this.db.getChargerConfig(row.id),
        this.db.getChargerSecrets(row.id),
      ]);
      return await plugin.createChargerMiddleware(row, { config, secrets });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Charger ${row.name} (${row.id}) not started: ${message}`,
      );
      return new UnconfiguredChargerMiddleware(row.id, message);
    }
  }

  async deleteCharger(id: string): Promise<void> {
    const entry = this.chargers.get(id);
    if (entry) {
      await entry.middleware.shutdown();
      this.chargers.delete(id);
      this.chargerPlugins.get(entry.row.chargerAdapterType)
        ?.onChargerRemoved?.(id);
    }
    await this.db.deleteCharger(id);
    await this.db.resequenceChargerPriorities();
    this.logger.info(`Charger deleted: ${id}`);
    const remaining = await this.db.getChargers();
    if (!remaining.some((r) => r.kind === "smart")) {
      await this.setVehicleApiActive(true);
    }
    this.eventEmitter.emit("chargers_changed", {});
  }

  // Vehicle-API points are deactivated rather than deleted so that their
  // schedules, logs and stats survive a control-path switch.
  private async setVehicleApiActive(active: boolean): Promise<void> {
    const rows = await this.db.getChargers();
    const targets = rows.filter((r) =>
      r.kind === "vehicle_api" && r.active !== active
    );
    await targets.reduce(
      (chain, row) =>
        chain.then(async () => {
          await this.db.updateChargerActive(row.id, active);
          if (active) await this.addCharger({ ...row, active: true });
          else await this.stopAndUnregister(row.id);
          this.logger.info(
            `Charging point ${row.name} ${
              active ? "reactivated" : "deactivated"
            }`,
          );
        }),
      Promise.resolve(),
    );
    if (targets.length > 0) this.eventEmitter.emit("chargers_changed", {});
  }

  // Handing control over must not leave the car drawing under a stale amp
  // command that nothing will revisit.
  private async stopAndUnregister(id: string): Promise<void> {
    const entry = this.chargers.get(id);
    if (!entry) return;
    const state = entry.middleware.getCachedState();
    if (state?.isCharging) {
      await this.stopCharging(
        id,
        { origin: "control-path", traceId: crypto.randomUUID() },
        state,
        { force: true },
      );
    }
    await entry.middleware.shutdown();
    this.chargers.delete(id);
  }

  async requestState(
    id: string,
    ctx: CallContext,
  ): Promise<ChargerState | null> {
    const entry = this.chargers.get(id);
    if (!entry) return null;
    try {
      const state = this.enrich(await entry.middleware.requestState(ctx));
      if (state && state.lastUpdated !== entry.lastEmittedAt) {
        entry.lastEmittedAt = state.lastUpdated;
        this.eventEmitter.emit("charger_update", {
          ...state,
          chargerName: entry.row.name,
        });
      }
      if (state?.isCharging === false) entry.lastCommandedAmps = null;
      await this.resetModeOnUnplug(id, state, ctx);
      return state;
    } catch (error) {
      this.logger.warn(
        `State fetch failed for ${entry.row.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.enrich(entry.middleware.getCachedState() ?? null);
    }
  }

  // A cable pull ends a charge_now/stop session override.
  private async resetModeOnUnplug(
    id: string,
    state: ChargerState | null,
    ctx: CallContext,
  ): Promise<void> {
    const entry = this.chargers.get(id);
    if (!entry) return;
    const pluggedIn = state?.isPluggedIn ?? null;
    const unplugged = entry.lastPluggedIn === true && pluggedIn === false;
    entry.lastPluggedIn = pluggedIn ?? entry.lastPluggedIn;
    if (!unplugged) return;
    // A different car may plug in next, so the standing permission a passive
    // hold left behind must be re-issued rather than assumed.
    entry.heldOpen = false;
    if (entry.row.mode === "auto") return;
    this.logger.info(`Unplugged: resetting ${entry.row.id} to auto`);
    await this.setMode(entry.row.id, "auto", ctx);
  }

  // A point with no adapter still has a row and a card, but nothing to
  // drive. Reads the cache directly — enrich() derives amps we never use.
  isControllable(id: string): boolean {
    const entry = this.chargers.get(id);
    return entry !== undefined &&
      entry.middleware.getCachedState()?.status !== "unconfigured";
  }

  getState(id: string): ChargerState | null {
    const entry = this.chargers.get(id);
    return this.enrich(entry?.middleware.getCachedState() ?? null);
  }

  private enrich(state: ChargerState | null): ChargerState | null {
    if (!state) return null;
    if (state.chargeAmps !== null || state.chargePowerKw === null) return state;
    if (this.cachedGridVoltage === null) return state;

    const energy = this.latestEnergy;
    const voltage = SolarAllocator.resolveVoltage(
      state.chargerVoltage,
      energy,
      this.cachedGridVoltage,
    );
    const watts = state.chargePowerKw * 1000;
    return {
      ...state,
      chargeAmps: Math.round((watts / (voltage * state.chargerPhases)) * 10) /
        10,
    };
  }

  async init(): Promise<void> {
    const solar = await this.configService.getSolar();
    this.cachedGridVoltage = solar.gridVoltage;
    this.eventEmitter.subscribe("config_changed", async () => {
      // The only remaining consumer here: charger config is row-scoped now
      // (see rebuildMiddlewareFor) and this event carries no row id, so it
      // rebuilds nothing charger-related — just the cached grid voltage.
      const updated = await this.configService.getSolar();
      this.cachedGridVoltage = updated.gridVoltage;
    });
    this.eventEmitter.subscribe("vehicles_changed", async () => {
      await this.syncVehicleChargingPoints();
    });
    this.eventEmitter.subscribe("energy_update", (data) => {
      this.latestEnergy = data.pollFailed ? null : data;
    });
    const rows = await this.db.getChargers();
    await rows.reduce(
      (chain, row) => chain.then(() => this.addCharger(row)),
      Promise.resolve(),
    );
  }

  // Cleans up after a deleted vehicle. Creating points for new vehicles is the vehicle-creation path's job, not an event's.
  // Only the vehicle's own API point is deleted — it exists solely to drive that one car, so it has nothing left to do. Any other point merely had
  // the car assigned to it: that is hardware the user still owns, so the assignment is cleared and the row stays. Deleting it instead would take the charger-keyed schedules set on it too, since deleteCharger cascades them (AppDatabase.deleteCharger).
  async syncVehicleChargingPoints(): Promise<void> {
    const [vehicles, rows] = await Promise.all([
      this.db.getVehicles(),
      this.db.getChargers(),
    ]);
    const vehicleIds = new Set(vehicles.map((v) => v.id));
    const stale = rows.filter((r) =>
      r.vehicleId !== null && !vehicleIds.has(r.vehicleId)
    );
    await stale.reduce(
      (chain, r) =>
        chain.then(() =>
          r.kind === "vehicle_api"
            ? this.deleteCharger(r.id)
            : this.setChargerVehicleId(r.id, null)
        ),
      Promise.resolve(),
    );
  }

  // Gives a newly added vehicle its own charging point, unless its plugin
  // has no charger role. Created inactive when a smart charger already owns control, so the vehicle still has something for the API-control toggle
  // to show and switch, in either setup order.
  async ensureVehicleChargingPoint(vehicle: VehicleRow): Promise<void> {
    if (!this.chargerPlugins.get(vehicle.adapterType)) return;
    const rows = await this.db.getChargers();
    const id = linkedChargingPointId(vehicle.id);
    if (rows.some((r) => r.id === id)) return;
    const active = !rows.some((r) => r.kind === "smart");
    const now = new Date().toISOString();
    const row: ChargerRow = {
      id,
      name: vehicle.name,
      chargerAdapterType: vehicle.adapterType,
      chargerConfig: "{}",
      mode: vehicle.mode,
      priority: vehicle.priority,
      vehicleId: vehicle.id,
      kind: "vehicle_api",
      active,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.upsertCharger(row);
    if (active) await this.addCharger(row);
    this.logger.info(
      `Charging point created for vehicle ${vehicle.name}${
        active ? "" : " (inactive, smart charger active)"
      }`,
    );
  }

  // Per-vehicle control-path switch: whether this car is driven by its own
  // API or by whichever smart charger it is plugged into.
  async setVehicleApiControl(
    vehicleId: string,
    active: boolean,
  ): Promise<void> {
    const rows = await this.db.getChargers();
    const row = rows.find((r) =>
      r.kind === "vehicle_api" && r.vehicleId === vehicleId
    );
    if (!row || row.active === active) return;
    await this.db.updateChargerActive(row.id, active);
    if (active) await this.addCharger({ ...row, active: true });
    else await this.stopAndUnregister(row.id);
    this.eventEmitter.emit("chargers_changed", {});
  }

  // Rebuild the running middleware for ONE charger row after a row-scoped config write. Never throws: a still-wrong config becomes an
  // UnconfiguredChargerMiddleware, so a bad Save still resolves. Registers the row if it is not yet in the map — the first save on a fresh
  // charger — and clears `lastCommandedAmps`, since amps commanded against the old adapter mean nothing against the new one.
  async rebuildMiddlewareFor(chargerRowId: string): Promise<void> {
    const entry = this.chargers.get(chargerRowId);
    if (entry === undefined) {
      const rows = await this.db.getChargers();
      const row = rows.find((r) => r.id === chargerRowId);
      if (row) await this.addCharger(row);
      return;
    }
    const plugin = this.chargerPlugins.get(entry.row.chargerAdapterType);
    if (!plugin) return;
    await entry.middleware.shutdown();
    entry.lastCommandedAmps = null;
    entry.middleware = await this.tryCreateMiddleware(plugin, entry.row);
    this.logger.info(`Rebuilt middleware for ${entry.row.id}`);
    this.eventEmitter.emit("chargers_changed", {});
  }

  async startChargingAt(
    id: string,
    amps: number,
    ctx: CallContext,
    state: ChargerState,
    { force = false } = {},
  ): Promise<{ success: boolean; error?: string }> {
    const entry = this.chargers.get(id);
    if (!entry) return { success: false, error: "Charger not registered" };
    if (this.isBackedOff(id).backedOff && !force) {
      return { success: false, error: "Command backoff active" };
    }
    try {
      const clamped = Math.max(
        state.chargeAmpsMin,
        Math.min(state.chargeAmpsMax, Math.round(amps)),
      );
      // Switch chargers never receive amp commands.
      const alreadyCommanded = entry.lastCommandedAmps === clamped &&
        state.isCharging;
      if (
        state.controlMode === "amps" && !alreadyCommanded &&
        state.chargeAmps !== clamped
      ) {
        const ok = await entry.middleware.setChargeAmps(
          clamped,
          { ...ctx, origin: `${ctx.origin}:set-amps` },
        );
        if (!ok) throw new Error(`setChargeAmps(${clamped}) rejected`);
      }
      entry.lastCommandedAmps = clamped;
      if (!state.isCharging) {
        const ok = await entry.middleware.startCharging(
          { ...ctx, origin: `${ctx.origin}:start` },
        );
        if (!ok) throw new Error("startCharging rejected");
        this.logger.info(`Started ${id} at ${clamped}A`);
      }
      this.resetCommandBackoff(id);
      return { success: true };
    } catch (error) {
      this.applyCommandBackoff(id, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async stopCharging(
    id: string,
    ctx: CallContext,
    state: ChargerState,
    { force = false } = {},
  ): Promise<{ success: boolean; error?: string }> {
    const entry = this.chargers.get(id);
    if (!entry) return { success: false, error: "Charger not registered" };
    if (!state.isCharging) return { success: true };
    if (this.isBackedOff(id).backedOff && !force) {
      return { success: false, error: "Command backoff active" };
    }
    try {
      const ok = await entry.middleware.stopCharging(
        { ...ctx, origin: `${ctx.origin}:stop` },
      );
      if (!ok) throw new Error("stopCharging rejected");
      entry.lastCommandedAmps = null;
      this.logger.info(`Stopped ${id}`);
      this.resetCommandBackoff(id);
      return { success: true };
    } catch (error) {
      this.applyCommandBackoff(id, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async resolveVehicleId(id: string): Promise<string | null> {
    return (await this.resolveVehicle(id)).vehicleId;
  }

  // Inference never guesses: exactly one plugged-in vehicle resolves
  // (charging or not); several plugged in is ambiguous.
  //
  // A vehicle_api row is already tied to its vehicle by construction (see
  // setChargerVehicleId) — that link always wins, state or no state.
  //
  // For a smart charger, an explicit assignment (entry.row.vehicleId) is a
  // preference, not a lock: it wins only while that car is actually plugged
  // in at THIS charger's home — i.e. the same isPluggedIn/isHome test as
  // inference below. Once it is unplugged (or driven away), it falls
  // through to inference exactly as if no assignment existed, rather than
  // resolving to "none" or to a car that is miles away. A vehicle with no
  // cached state yet (never polled) has no known isPluggedIn, so it is
  // treated the same as "not plugged in" and also falls through.
  async resolveVehicle(id: string): Promise<VehicleResolution> {
    const entry = this.chargers.get(id);
    if (!entry) return { kind: "none", vehicleId: null };

    const resolution = entry.row.kind === "smart"
      ? await this.resolveSmartCharger(entry.row.vehicleId)
      : this.resolveConstructionLinked(entry.row.vehicleId);

    if (entry.lastResolved !== resolution.vehicleId) {
      entry.lastResolved = resolution.vehicleId;
      this.logger.info(
        `Charger ${id}: vehicle resolution ${resolution.kind}` +
          (resolution.vehicleId ? ` (${resolution.vehicleId})` : ""),
      );
    }
    return resolution;
  }

  // vehicle_api rows are tied to their vehicle by construction — no state
  // check needed, unlike a smart charger's explicit assignment.
  private resolveConstructionLinked(
    vehicleId: string | null,
  ): VehicleResolution {
    return vehicleId
      ? { kind: "linked", vehicleId }
      : { kind: "none", vehicleId: null };
  }

  private async resolveSmartCharger(
    assignedId: string | null,
  ): Promise<VehicleResolution> {
    const states = await this.vehicleManager.getAllStates();
    if (assignedId !== null) {
      const assigned = states.get(assignedId);
      // isHome is null when unknown, so only an explicit false rules it out —
      // same precedent as the inference check below.
      if (assigned?.isPluggedIn && assigned.isHome !== false) {
        return { kind: "linked", vehicleId: assignedId };
      }
    }
    return await this.inferVehicle(states);
  }

  private async inferVehicle(
    states: Map<string, VehicleChargeState>,
  ): Promise<VehicleResolution> {
    // A car driven by its own API is not a candidate for this charger, and
    // one that is away cannot be plugged into it. isHome is null when
    // unknown, so only an explicit false rules a vehicle out.
    const selfDriven = new Set(
      (await this.db.getChargers())
        .filter((r) => r.kind === "vehicle_api" && r.active)
        .map((r) => r.vehicleId),
    );
    const pluggedIn = [...states]
      .filter(([vehicleId, v]) =>
        v.isPluggedIn && v.isHome !== false && !selfDriven.has(vehicleId)
      );
    return pluggedIn.length === 1
      ? { kind: "inferred", vehicleId: pluggedIn[0][0] }
      : { kind: pluggedIn.length > 1 ? "ambiguous" : "none", vehicleId: null };
  }

  // Vehicles driven by their own API that could be on a charger right now: an active vehicle_api point, plugged in, and not known to be away.
  // isHome is null when unknown, so only an explicit false rules one out — the same test inferVehicle uses. Public because it is the per-pass
  // cache for `getControlPath`: a caller looking at every charger computes this once and threads it in, rather than paying two DB reads per charger per controller loop.
  async getSelfDrivenVehicles(): Promise<Set<string>> {
    const [rows, states] = await Promise.all([
      this.db.getChargers(),
      this.vehicleManager.getAllStates(),
    ]);
    return new Set(
      rows
        .filter((r) => r.kind === "vehicle_api" && r.active)
        .flatMap((r) => r.vehicleId === null ? [] : [r.vehicleId])
        .filter((id) => {
          const v = states.get(id);
          return v?.isPluggedIn === true && v.isHome !== false;
        }),
    );
  }

  // Derived, never stored: a smart charger goes passive only while a self-driven car is the one on it. A second, dumb car on the same charger
  // resolves normally and the charger keeps full control for it. Deriving this rather than storing a second flag is deliberate — a stored "passive"
  // bit and the row's `active` bit could disagree, and `active` is per-row so it could not vary by which car is plugged in anyway. `selfDriven` is the optional per-pass cache from `getSelfDrivenVehicles`; omit it and one is computed for this call. Clears a stale hold as a side effect when control comes back: the next controlled loop must re-decide amps from scratch, not inherit the standing maximum that passive left behind.
  async getControlPath(
    id: string,
    selfDriven?: ReadonlySet<string>,
  ): Promise<ControlPath> {
    const entry = this.chargers.get(id);
    if (!entry || entry.row.kind !== "smart") {
      return { owner: "self", passiveForVehicleId: null };
    }
    const vehicleId = await this.passiveVehicleFor(
      id,
      selfDriven ?? await this.getSelfDrivenVehicles(),
    );
    if (vehicleId === null) {
      this.releaseHold(id);
      return { owner: "self", passiveForVehicleId: null };
    }
    return { owner: "vehicle_api", passiveForVehicleId: vehicleId };
  }

  // The self-driven vehicle this smart charger is passing current to, or
  // null when it is deciding for itself.
  private async passiveVehicleFor(
    id: string,
    selfDriven: ReadonlySet<string>,
  ): Promise<string | null> {
    if (selfDriven.size === 0) return null;
    const resolved = (await this.resolveVehicle(id)).vehicleId;
    if (resolved !== null) return selfDriven.has(resolved) ? resolved : null;
    // Resolution found nobody precisely because inferVehicle skips
    // self-driven cars. Exactly one such car plugged in at home is the one
    // on this charger; more than one is as ambiguous as any other pair.
    const [only] = [...selfDriven];
    return selfDriven.size === 1 ? only : null;
  }

  private releaseHold(id: string): void {
    const entry = this.chargers.get(id);
    if (!entry?.heldOpen) return;
    entry.heldOpen = false;
    entry.lastCommandedAmps = null;
  }

  // Passive hold for a smart charger whose car is driven by its own API. Doing nothing is not passive enough to work. An OCPP charger keeps the
  // last ChargingProfile it was sent, so a charger left at 6A by solar tracking caps the car at 6A however much its own API asks for; and a charger
  // that never received RemoteStart never closes its contactor at all. Passive therefore means a standing permission — the connector's own maximum, and one start — after which the point issues nothing: no stop, no amp adjustment, no schedules, no solar tracking. Once per plug-in, NOT once per loop. Do not "fix" this into a per-loop re-start. If the car's own API ends the charge the transaction ends with it, and re-issuing RemoteStart every loop would fight the car for as long as it stayed plugged in. The accepted cost is the other side of that trade: a car that finishes mid-session leaves the charger armed but idle until the cable is pulled, which draws nothing and is cleared by resetModeOnUnplug's unplug edge.
  async holdOpen(id: string, ctx: CallContext): Promise<void> {
    const entry = this.chargers.get(id);
    if (!entry || entry.heldOpen) return;
    const state = this.getState(id);
    if (!state?.isPluggedIn) return;
    entry.heldOpen = true;
    this.logger.info(`Passive hold: ${id} opened to ${state.chargeAmpsMax}A`);
    await this.startChargingAt(id, state.chargeAmpsMax, ctx, state);
  }

  // Explicit vehicle assignment for a smart charger — resolveVehicle prefers this over inference. `null` clears it, returning to inference. Updates
  // the in-memory row so the next controller loop or resolveVehicle call sees it immediately; no rebuild/restart needed since the adapter itself
  // is unaffected. Only meaningful for `kind: "smart"` rows — vehicle_api rows are already tied to their vehicle by construction.
  async setChargerVehicleId(
    id: string,
    vehicleId: string | null,
  ): Promise<void> {
    const entry = this.chargers.get(id);
    if (!entry || entry.row.kind !== "smart") return;
    await this.db.updateChargerVehicleId(id, vehicleId);
    entry.row = { ...entry.row, vehicleId };
    this.eventEmitter.emit("chargers_changed", {});
  }

  async setMode(
    id: string,
    mode: ChargingPointMode,
    ctx: CallContext,
  ): Promise<void> {
    await this.db.updateChargerMode(id, mode);
    const entry = this.chargers.get(id);
    if (entry) entry.row = { ...entry.row, mode };
    this.eventEmitter.emit("chargers_changed", {});

    const state = this.getState(id);
    if (!state) return;
    if (mode === "charge_now") {
      await this.startChargingAt(id, state.chargeAmpsMax, ctx, state, {
        force: true,
      });
    }
    if (mode === "stop") {
      await this.stopCharging(id, ctx, state, { force: true });
    }
  }

  async reorder(order: string[]): Promise<void> {
    await Promise.all(
      order.map((id, i) => this.db.updateChargerPriority(id, i + 1)),
    );
    this.eventEmitter.emit("chargers_changed", {});
  }

  // Always creates a new row, even if one of this adapter type already
  // exists — a second Tapo or a second OCPP charger is a new row, not a reuse of the first. Two rows of the same type would be indistinguishable
  // in the UI, so the second (and later) gets a count appended to its name.
  async createCharger(
    input: {
      name: string;
      chargerAdapterType: string;
      config?: ChargerConfigMap;
      secrets?: ChargerSecretsMap;
    },
  ): Promise<ChargerRow> {
    const rows = await this.db.getChargers();
    const row: ChargerRow = {
      id: crypto.randomUUID(),
      name: input.name,
      chargerAdapterType: input.chargerAdapterType,
      chargerConfig: JSON.stringify(input.config ?? {}),
      mode: "auto",
      priority: rows.length + 1,
      vehicleId: null,
      kind: "smart",
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.db.createChargerWithConfig(
      row,
      input.config ?? {},
      input.secrets ?? {},
    );
    await this.addCharger(row);
    // One control path per car: the first smart charger takes over.
    if (!rows.some((r) => r.kind === "smart")) {
      await this.setVehicleApiActive(false);
    }
    return row;
  }

  async createChargerForType(
    chargerAdapterType: string,
    seed: {
      name?: string;
      config?: ChargerConfigMap;
      secrets?: ChargerSecretsMap;
    } = {},
  ): Promise<ChargerRow> {
    return await this.createCharger({
      name: seed.name ??
        await this.defaultChargerName(chargerAdapterType),
      chargerAdapterType,
      config: seed.config,
      secrets: seed.secrets,
    });
  }

  // The counter only disambiguates repeats of a plugin's own label — a
  // device-reported name is already unique to its hardware.
  private async defaultChargerName(
    chargerAdapterType: string,
  ): Promise<string> {
    const label = this.chargerPlugins.get(chargerAdapterType)?.displayName ??
      chargerAdapterType;
    const rows = await this.db.getChargers();
    const sameType = rows.filter((row) =>
      row.chargerAdapterType === chargerAdapterType
    );
    return sameType.length === 0 ? label : `${label} ${sameType.length + 1}`;
  }

  // Find-or-create, by adapter type. Only the first-run wizard needs this:
  // re-running it after the charger step already ran must not create a second row. Every other creation path (Settings "Add charger", a
  // plugin's own add-mode save) must always create — see `createChargerForType` / `createCharger`.
  async ensureCharger(chargerAdapterType: string): Promise<ChargerRow> {
    const rows = await this.db.getChargers();
    const existing = rows.find((row) =>
      row.chargerAdapterType === chargerAdapterType
    );
    if (existing) return existing;
    return await this.createChargerForType(chargerAdapterType);
  }

  // Live charging load, split by whether a physical meter would already have
  // counted it. `unmeteredW` applies to any energy reading; `meteredW` only to an adapter that measures nothing itself. See docs/simulated-load.md.
  // Counted once: a vehicle charging through a charger is one physical load, so the charger's reading wins and that vehicle is skipped.
  async getChargingLoadW(): Promise<
    { unmeteredW: number; meteredW: number }
  > {
    const selfDriven = await this.getSelfDrivenVehicles();
    const perCharger = await Promise.all(
      [...this.chargers].map(async ([id, entry]) => {
        const path = await this.getControlPath(id, selfDriven);
        return {
          // Raw cached state rather than getState(): enrich() reads the energy
          // snapshot back, and this figure is about to feed the energy adapter.
          powerW: watts(entry.middleware.getCachedState()?.chargePowerKw),
          // Declared by the plugin behind this point, whichever kind it is —
          // a vehicle_api point is the car's own API and a smart point is the
          // charger, and either can be a simulation that moves no
          // electricity. Without this a simulated car vanishes from a real
          // inverter's reading, the one case docs/simulated-load.md says must
          // be added.
          // Explicit true only: metered is the safe default, so a plugin that
          // says nothing stays out of a measuring adapter's reading.
          unmetered: this.chargerPlugins.get(entry.row.chargerAdapterType)
            ?.loadIsUnmetered === true,
          // A passive charger's car reports the same physical draw through
          // its own API, and resolveVehicle deliberately returns nobody for
          // it. Claim it here or the one session is counted twice.
          vehicleId: path.passiveForVehicleId ??
            (await this.resolveVehicle(id)).vehicleId,
        };
      }),
    );
    const claimed = new Set(
      perCharger.flatMap((c) => c.vehicleId === null ? [] : [c.vehicleId]),
    );
    const [states, rows] = await Promise.all([
      this.vehicleManager.getAllStates(),
      this.db.getVehicles(),
    ]);
    // Classified by what the plugin declares about itself, not by its id.
    const unmeteredById = new Map(
      rows.map((
        r,
      ) => [r.id, this.vehicleManager.loadIsUnmetered(r.adapterType)]),
    );
    const unclaimed = [...states].filter(([id]) => !claimed.has(id));
    const sumVehicles = (unmetered: boolean) =>
      unclaimed.reduce(
        (total, [id, state]) =>
          (unmeteredById.get(id) ?? false) === unmetered
            ? total + watts(state.chargePowerKw)
            : total,
        0,
      );

    const sumChargers = (unmetered: boolean) =>
      perCharger.reduce(
        (total, c) => c.unmetered === unmetered ? total + c.powerW : total,
        0,
      );

    return {
      unmeteredW: sumVehicles(true) + sumChargers(true),
      meteredW: sumVehicles(false) + sumChargers(false),
    };
  }

  async getChargersWithState() {
    const [rows, selfDriven] = await Promise.all([
      this.db.getChargers(),
      this.getSelfDrivenVehicles(),
    ]);
    return await Promise.all(rows.map(async (row) => {
      const [resolution, controlPath] = await Promise.all([
        this.resolveVehicle(row.id),
        this.getControlPath(row.id, selfDriven),
      ]);
      // Withheld: carries plug host addresses and account emails.
      const { chargerConfig: _chargerConfig, ...wireRow } = row;
      return {
        ...wireRow,
        state: this.getState(row.id),
        resolvedVehicleId: resolution.vehicleId,
        vehicleResolution: resolution.kind,
        controlOwner: controlPath.owner,
        passiveForVehicleId: controlPath.passiveForVehicleId,
      };
    }));
  }

  isBackedOff(id: string): { backedOff: boolean; remainingMs: number } {
    const bs = this.commandBackoff.get(id);
    if (!bs?.backoffUntil) return { backedOff: false, remainingMs: 0 };
    const remainingMs = bs.backoffUntil - Date.now();
    if (remainingMs <= 0) {
      bs.backoffUntil = null;
      return { backedOff: false, remainingMs: 0 };
    }
    return { backedOff: true, remainingMs };
  }

  private applyCommandBackoff(id: string, error: unknown): void {
    const existing = this.commandBackoff.get(id);
    const bs = existing ?? { failures: 0, backoffUntil: null };
    if (!existing) this.commandBackoff.set(id, bs);
    bs.failures++;
    const backoffSec = Math.min(
      MAX_COMMAND_BACKOFF_SEC,
      30 * Math.pow(2, bs.failures - 1),
    );
    bs.backoffUntil = Date.now() + backoffSec * 1000;
    this.logger.error(
      `Command failed for ${id} (backoff ${backoffSec}s):`,
      error,
    );
  }

  private resetCommandBackoff(id: string): void {
    const bs = this.commandBackoff.get(id);
    if (bs) {
      bs.failures = 0;
      bs.backoffUntil = null;
    }
  }
}
