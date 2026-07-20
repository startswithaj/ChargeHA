import { ServiceError } from "../lib/ServiceError.ts";
import {
  createTraceId,
  type VehicleAdapterType,
  type VehicleMode,
} from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleRow } from "../db/types.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { Logger } from "../lib/Logger.ts";

export type VehicleWithLiveState = Awaited<
  ReturnType<typeof enrichVehicleRows>
>[number];

/** Enrich vehicle rows with live state, location, and last error — shared by
 *  the main vehicle list and plugin-scoped lists so the shapes never drift. */
export async function enrichVehicleRows(
  rows: VehicleRow[],
  vehicleManager: VehicleManager,
) {
  return await Promise.all(rows.map(async (v) => {
    const error = vehicleManager.getVehicleError(v.id);
    const state = await vehicleManager.getState(v.id);
    const lastLocation = state?.latitude != null && state?.longitude != null
      ? { latitude: state.latitude, longitude: state.longitude }
      : null;
    return {
      ...v,
      state,
      lastLocation,
      lastError: error?.message ?? null,
      lastErrorAt: error?.at ?? null,
    };
  }));
}

/**
 * tRPC-facing API layer for the dashboard. Each method maps to a tRPC
 * procedure — it validates input, calls VehicleManager, and wraps errors
 * for the client.
 */
export class VehicleService {
  private readonly db: AppDatabase;
  private readonly vehicleManager: VehicleManager;
  private readonly vehiclePlugins: VehiclePluginRegistry;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly logger: Logger;

  constructor(
    db: AppDatabase,
    vehicleManager: VehicleManager,
    vehiclePlugins: VehiclePluginRegistry,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
  ) {
    this.db = db;
    this.vehicleManager = vehicleManager;
    this.vehiclePlugins = vehiclePlugins;
    this.eventEmitter = eventEmitter;
    this.logger = logger;
  }

  /** Returns registered vehicle plugins with configuration status. */
  async getPluginSummaries(): Promise<
    Array<{
      id: string;
      displayName: string;
      configured: boolean;
      settingsComponentKey: string | null;
    }>
  > {
    const allVehicles = await this.listVehicles();
    return this.vehiclePlugins.getAll().map((plugin) => {
      const hasVehicles = allVehicles.some((v) => v.adapterType === plugin.id);
      return {
        id: plugin.id,
        displayName: plugin.displayName,
        configured: hasVehicles,
        settingsComponentKey: plugin.settingsComponentKey,
      };
    });
  }

  /** Check command readiness for a specific vehicle, delegating to its plugin. */
  async getCommandStatus(
    vehicleId: string,
  ): Promise<{ commandsDisabled: boolean; reason: string | null }> {
    const vehicle = await this.db.getVehicle(vehicleId);
    const plugin = vehicle && this.vehiclePlugins.get(vehicle.adapterType);
    if (!plugin) {
      return { commandsDisabled: false, reason: null };
    }
    return await plugin.getCommandStatus();
  }

  /** Get a vehicle row or throw NOT_FOUND. */
  async getVehicleOrThrow(vehicleId: string): Promise<VehicleRow> {
    const vehicle = await this.db.getVehicle(vehicleId);
    if (!vehicle) {
      throw new ServiceError("Vehicle not found", "NOT_FOUND");
    }
    return vehicle;
  }

  /** List all configured vehicles with latest state and location. */
  async listVehicles() {
    return await enrichVehicleRows(
      await this.db.getVehicles(),
      this.vehicleManager,
    );
  }

  /** Create a new vehicle and register it with the manager. */
  async createVehicle(input: {
    id: string;
    name: string;
    adapterType: VehicleAdapterType;
    priority?: number;
    config?: string;
    mode?: VehicleMode;
  }) {
    const existing = await this.db.getVehicle(input.id);
    if (existing) {
      throw new ServiceError(
        "Vehicle with this ID already exists",
        "CONFLICT",
      );
    }

    const row = {
      id: input.id,
      name: input.name,
      adapterType: input.adapterType,
      priority: input.priority ?? await this.db.getNextVehiclePriority(),
      config: input.config ?? "{}",
      mode: input.mode ?? "auto",
    };

    await this.db.upsertVehicle(row);

    // Register with VehicleManager so it starts polling immediately
    try {
      const vehicleRow = await this.db.getVehicle(input.id);
      if (vehicleRow) {
        await this.vehicleManager.addVehicle(vehicleRow);
      }
    } catch (err) {
      this.logger.warn(
        `Created vehicle ${input.id} but failed to start adapter:`,
        err,
      );
    }

    return { success: true, vehicle: row };
  }

  /** Delete a vehicle from DB and manager. */
  async deleteVehicle(vehicleId: string) {
    await this.getVehicleOrThrow(vehicleId);
    await this.vehicleManager.deleteVehicle(vehicleId);
    return { success: true };
  }

  /** Set vehicle mode (auto/charge_now/stop). */
  async setMode(vehicleId: string, mode: VehicleMode) {
    const vehicle = await this.getVehicleOrThrow(vehicleId);
    await this.db.updateVehicleMode(vehicleId, mode);

    this.eventEmitter.emit("vehicle_mode_changed", {
      vehicleId,
      vehicleName: vehicle.name,
      mode,
    });

    // For charge_now, start charging at max amps immediately rather than
    // waiting for the next controller loop (up to 30s delay).
    if (mode === "charge_now") {
      const state = await this.vehicleManager.getState(vehicleId);
      if (state) {
        await this.vehicleManager.startChargingAt(
          vehicleId,
          state.chargeAmpsMax,
          { origin: "user:charge-now", traceId: createTraceId() },
          state,
        );
      }
    }

    return { success: true, mode };
  }

  /** Set vehicle priority. */
  async setPriority(vehicleId: string, priority: number) {
    await this.getVehicleOrThrow(vehicleId);
    await this.db.updateVehiclePriority(vehicleId, priority);
    return { success: true, priority };
  }

  /** Execute a vehicle command (start/stop/wake). */
  async executeCommand(vehicleId: string, command: "start" | "stop" | "wake") {
    await this.getVehicleOrThrow(vehicleId);

    try {
      switch (command) {
        case "start": {
          const state = await this.vehicleManager.getState(vehicleId);
          if (!state) {
            return { success: false, state: null };
          }
          const result = await this.vehicleManager.startChargingAt(
            vehicleId,
            state.chargeAmpsMax,
            { origin: "user:command:start", traceId: createTraceId() },
            state,
            { force: true },
          );
          // Set mode to auto so the controller continues managing charging.
          await this.db.updateVehicleMode(vehicleId, "auto");
          return { success: result.success, state: result.state ?? null };
        }
        case "stop": {
          const state = await this.vehicleManager.getState(vehicleId);
          if (!state) {
            return { success: false, state: null };
          }
          const result = await this.vehicleManager.stopCharging(
            vehicleId,
            { origin: "user:command:stop", traceId: createTraceId() },
            state,
            { force: true },
          );
          // Set mode to stop so the controller doesn't restart charging next cycle.
          // Mode resets to auto on unplug.
          await this.db.updateVehicleMode(vehicleId, "stop");
          return { success: result.success, state: result.state ?? null };
        }
        case "wake": {
          const state = await this.vehicleManager.requestState(
            vehicleId,
            {
              origin: "user:command:wake",
              traceId: createTraceId(),
              hasSolar: false,
              hasSchedule: false,
              hasBlockout: false,
              forceRefresh: true,
            },
          );
          return { success: !!state, state };
        }
      }
    } catch (error) {
      throw new ServiceError(
        error instanceof Error ? error.message : "Command failed",
        "INTERNAL_SERVER_ERROR",
        { cause: error },
      );
    }
  }

  /** Set charging amps. */
  async setAmps(vehicleId: string, amps: number) {
    await this.getVehicleOrThrow(vehicleId);

    try {
      const state = await this.vehicleManager.getState(vehicleId);
      if (!state) {
        return { success: false, state: null };
      }
      const result = await this.vehicleManager.startChargingAt(
        vehicleId,
        amps,
        { origin: "user:set-amps", traceId: createTraceId() },
        state,
        { force: true },
      );
      return { success: result.success, state: result.state ?? null };
    } catch (error) {
      throw new ServiceError(
        error instanceof Error ? error.message : "Command failed",
        "INTERNAL_SERVER_ERROR",
        { cause: error },
      );
    }
  }

  /** Force-poll a vehicle for fresh state. Wakes the vehicle if asleep. */
  async refreshState(vehicleId: string) {
    await this.getVehicleOrThrow(vehicleId);
    const state = await this.vehicleManager.requestState(
      vehicleId,
      {
        origin: "user:refresh",
        traceId: createTraceId(),
        hasSolar: false,
        hasSchedule: false,
        hasBlockout: false,
        forceRefresh: true,
      },
    );
    return { state };
  }
}
