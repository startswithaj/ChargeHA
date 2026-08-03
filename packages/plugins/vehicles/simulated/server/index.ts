import type { AnyRouter } from "@trpc/server";
import { defineSection } from "@chargeha/shared/configSections";
import type { ChargerRow, VehicleRow } from "@chargeha/server/db/types";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  CommandStatus,
  PluginHealthCheck,
  PluginHttpRoutes,
  PluginTunnelRoute,
  VehicleMiddleware,
  VehiclePlugin,
} from "../../../types.ts";
import {
  SimulatedVehicleAdapter,
  type SimulatedVehicleConfig,
} from "./SimulatedVehicleAdapter.ts";
import { SimulatedVehicleMiddleware } from "./SimulatedVehicleMiddleware.ts";
import { SimulatedChargerMiddleware } from "./SimulatedChargerMiddleware.ts";
import { createSimulatedRouter } from "./router.ts";

/** Parse a JSON string into SimulatedVehicleConfig, returning {} on failure. */
function parseVehicleConfig(
  json: string,
): SimulatedVehicleConfig | Record<string, never> {
  try {
    return JSON.parse(json) as SimulatedVehicleConfig;
  } catch {
    return {};
  }
}

/** Empty config section — simulated vehicles have no configurable settings. */
export const simulatedConfigDef = defineSection({});

/**
 * Simulated vehicle plugin — creates SimulatedVehicleAdapter instances for
 * testing and demo use. Pushes aggregated simulated charging load into
 * EnergyAdapterManager via `deps.setSimulatedLoad`.
 */
export class SimulatedVehiclePlugin implements VehiclePlugin, ChargerPlugin {
  readonly id = "simulated";
  readonly displayName = "Simulated";
  readonly vendor = "ChargeHA";
  readonly configDef = simulatedConfigDef;
  readonly secretKeys: readonly string[] = [];
  readonly settingsComponentKey = "simulated-settings";

  private readonly adapters = new Map<string, SimulatedVehicleAdapter>();
  private readonly middlewares = new Map<string, SimulatedVehicleMiddleware>();
  private readonly startupPromise: Promise<void>;

  constructor(private readonly deps: PluginDependencies) {
    this.startupPromise = this.startup();
  }

  private async startup(): Promise<void> {
    const rows = await this.deps.getVehicleRows();
    await Promise.all(rows.map((row) => this.deps.addVehicle(row)));
  }

  // deno-lint-ignore require-await
  async createVehicleMiddleware(row: VehicleRow): Promise<VehicleMiddleware> {
    return this.sharedMiddleware(row);
  }

  private sharedMiddleware(row: VehicleRow): SimulatedVehicleMiddleware {
    const existing = this.middlewares.get(row.id);
    if (existing) return existing;
    const userConfig = row.config ? parseVehicleConfig(row.config) : {};
    const sim = new SimulatedVehicleAdapter(
      row.id,
      userConfig,
      this.deps.log,
      this.deps.dbLog,
    );
    sim.onPowerChange = () => this.recalculate();
    this.adapters.set(row.id, sim);
    const middleware = new SimulatedVehicleMiddleware(sim);
    this.middlewares.set(row.id, middleware);
    return middleware;
  }

  // The charger role. The migration guarantees vehicleId is set on
  // simulated charger rows.
  async createChargerMiddleware(row: ChargerRow): Promise<ChargerMiddleware> {
    if (row.vehicleId === null) {
      throw new Error(`Simulated charger row ${row.id} has no vehicleId`);
    }
    const vehicles = await this.deps.getVehicleRows();
    const vehicle = vehicles.find((v) => v.id === row.vehicleId);
    if (!vehicle) {
      throw new Error(
        `No Simulated vehicle ${row.vehicleId} for charger ${row.id}`,
      );
    }
    return new SimulatedChargerMiddleware(row, this.sharedMiddleware(vehicle));
  }

  getChargerHttpRoutes(): PluginHttpRoutes | null {
    return null;
  }

  async shutdown(): Promise<void> {
    await this.startupPromise.catch((err) => {
      this.deps.log.error("Startup had failed before shutdown:", err);
    });
    this.adapters.clear();
    this.middlewares.clear();
  }

  /** Total simulated power draw across all adapters. Router helper. */
  getTotalPowerW(): number {
    return this.adapters.values().reduce(
      (total, adapter) => total + adapter.getCurrentPowerW(),
      0,
    );
  }

  /** Look up a simulated adapter by vehicle id. Router helper. */
  getAdapter(vehicleId: string): SimulatedVehicleAdapter | undefined {
    return this.adapters.get(vehicleId);
  }

  private recalculate(): void {
    this.deps.setSimulatedLoad(this.getTotalPowerW());
  }

  getRouter(): AnyRouter {
    return createSimulatedRouter(this, this.deps);
  }

  /** Simulated vehicles are always commandable. */
  getCommandStatus(): Promise<CommandStatus> {
    return Promise.resolve({ commandsDisabled: false, reason: null });
  }

  getVehicleHttpRoutes(): null {
    return null;
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }

  getTunnelRoutes(): PluginTunnelRoute[] {
    return [];
  }
}
