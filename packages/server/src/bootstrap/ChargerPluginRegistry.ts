import type { AnyRouter } from "@trpc/server";
import type {
  ChargerPlugin,
  PluginHealthCheck,
} from "@chargeha/shared/plugins";
import { resolveHttpRoutes } from "@chargeha/shared/plugins";

export class ChargerPluginRegistry {
  private readonly plugins = new Map<string, ChargerPlugin>();

  register(plugin: ChargerPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Duplicate charger plugin id: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): ChargerPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): ChargerPlugin[] {
    return [...this.plugins.values()];
  }

  getPluginRouters(): Record<string, AnyRouter> {
    return Object.fromEntries(
      [...this.plugins]
        .map(([id, plugin]) => [id, plugin.getRouter()] as const)
        .filter((entry): entry is [string, AnyRouter] => entry[1] != null),
    );
  }

  getHttpRoutes() {
    return resolveHttpRoutes(
      "/api/charger",
      [...this.plugins].map(([id, p]) => [id, p.getChargerHttpRoutes()]),
    );
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [...this.plugins.values()].flatMap((p) => p.getHealthChecks());
  }

  async shutdownAll(): Promise<void> {
    // allSettled, not all: one plugin failing must not skip the others.
    const results = await Promise.allSettled(
      [...this.plugins.values()].map((p) => p.shutdown()),
    );
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.reason),
        "One or more charger plugins failed to shut down",
      );
    }
  }
}
