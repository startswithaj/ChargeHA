import type { AnyRouter } from "@trpc/server";
import type {
  PluginHealthCheck,
  VehiclePlugin,
} from "@chargeha/shared/plugins";
import { resolveHttpRoutes } from "@chargeha/shared/plugins";

// Thin container for vehicle plugins. Starts empty; plugins are constructed
// and passed in via `register()`. Plugins initialize themselves in their own constructors (kicked off by `PluginDependencies`), so the registry does not own lifecycle concerns beyond collection + shutdown aggregation.
export class VehiclePluginRegistry {
  private readonly plugins = new Map<string, VehiclePlugin>();

  register(plugin: VehiclePlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Duplicate vehicle plugin id: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): VehiclePlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): VehiclePlugin[] {
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
      "/api/vehicle",
      [...this.plugins].map(([id, p]) => [id, p.getVehicleHttpRoutes()]),
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
        "One or more vehicle plugins failed to shut down",
      );
    }
  }
}
