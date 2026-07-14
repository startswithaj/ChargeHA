import type { AnyRouter } from "@trpc/server";
import { defineSection } from "@chargeha/shared/configSections";
import type { VehicleRow } from "@chargeha/server/db/types";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type {
  PluginHealthCheck,
  PluginTunnelRoute,
  VehicleMiddleware,
  VehiclePlugin,
} from "../../../types.ts";
import {
  SimulatedVehicleAdapter,
  type SimulatedVehicleConfig,
} from "./SimulatedVehicleAdapter.ts";
import { TeslaVehicleMiddleware } from "../../tesla/server/TeslaVehicleMiddleware.ts";
import { simulatedRouter } from "./router.ts";

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
export class SimulatedVehiclePlugin implements VehiclePlugin {
  readonly id = "simulated";
  readonly displayName = "Simulated";
  readonly configDef = simulatedConfigDef;
  readonly secretKeys: readonly string[] = [];
  readonly settingsComponentKey = "simulated-settings";

  private readonly adapters = new Map<string, SimulatedVehicleAdapter>();
  private readonly startupPromise: Promise<void>;

  constructor(private readonly deps: PluginDependencies) {
    this.startupPromise = this.startup();
  }

  private async startup(): Promise<void> {
    const rows = await this.deps.getVehicleRows();
    await Promise.all(rows.map((row) => this.deps.addVehicle(row)));
  }

  // deno-lint-ignore require-await
  async createMiddleware(row: VehicleRow): Promise<VehicleMiddleware> {
    const userConfig = row.config ? parseVehicleConfig(row.config) : {};
    const sim = new SimulatedVehicleAdapter(
      row.id,
      userConfig,
      this.deps.log,
      this.deps.dbLog,
    );
    sim.onPowerChange = () => this.recalculate();
    this.adapters.set(row.id, sim);
    return new TeslaVehicleMiddleware(sim, this.deps.log);
  }

  async shutdown(): Promise<void> {
    await this.startupPromise.catch((err) => {
      this.deps.log.error("Startup had failed before shutdown:", err);
    });
    this.adapters.clear();
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
    return simulatedRouter;
  }

  getHttpRoutes(): null {
    return null;
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }

  getTunnelRoutes(): PluginTunnelRoute[] {
    return [];
  }
}
