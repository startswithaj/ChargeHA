import type { AnyRouter } from "@trpc/server";
import { defineSection } from "@chargeha/shared/configSections";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/shared";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  PluginHealthCheck,
  PluginHttpRoutes,
} from "@chargeha/shared/plugins";
import { PollingChargerMiddleware } from "../../PollingChargerMiddleware.ts";
import { SimulatedChargerAdapter } from "./SimulatedChargerAdapter.ts";
import { createSimulatedChargerRouter } from "./router.ts";

/** Empty config section — the simulated charger has no configurable
 *  settings; dev state lives in the adapter, driven via the router. */
export const simulatedChargerConfigDef = defineSection({});

/** Simulated charger plugin — an in-memory EVSE twin for the charger side
 *  of the wizard "Yes" flow, with no hardware and no docker stack. */
export class SimulatedChargerPlugin implements ChargerPlugin {
  readonly id = "simulated_charger";
  readonly displayName = "Simulated Charger";
  readonly vendor = "ChargeHA";
  readonly settingsComponentKey = "simulated_charger-settings";
  readonly configDef = simulatedChargerConfigDef;
  readonly secretKeys: readonly string[] = [];

  private readonly adapters = new Map<string, SimulatedChargerAdapter>();

  constructor(private readonly deps: PluginDependencies) {}

  // deno-lint-ignore require-await
  async createChargerMiddleware(row: ChargerRow): Promise<ChargerMiddleware> {
    const adapter = new SimulatedChargerAdapter(row.id);
    this.adapters.set(row.id, adapter);
    return new PollingChargerMiddleware(adapter, this.deps.log);
  }

  /** All live adapters, keyed by charger row id. Router helper. */
  getAdapters(): SimulatedChargerAdapter[] {
    return [...this.adapters.values()];
  }

  getRouter(): AnyRouter {
    return createSimulatedChargerRouter(() => this.getAdapters());
  }

  getChargerHttpRoutes(): PluginHttpRoutes | null {
    return null;
  }

  getHealthChecks(): PluginHealthCheck[] {
    // A simulator is never unhealthy.
    return [];
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
