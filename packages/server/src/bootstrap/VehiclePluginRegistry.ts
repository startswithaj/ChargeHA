import type { AnyRouter } from "@trpc/server";
import type { PluginHealthCheck, VehiclePlugin } from "@chargeha/plugins/types";

/**
 * Thin container for vehicle plugins. Starts empty; plugins are constructed
 * and passed in via `register()`. Plugins initialize themselves in their own
 * constructors (kicked off by `PluginDependencies`), so the registry does
 * not own lifecycle concerns beyond collection + shutdown aggregation.
 */
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

  /** Collects non-null tRPC routers from all registered plugins, keyed by plugin id. */
  getPluginRouters(): Record<string, AnyRouter> {
    return Object.fromEntries(
      [...this.plugins]
        .map(([id, plugin]) => [id, plugin.getRouter()] as const)
        .filter((entry): entry is [string, AnyRouter] => entry[1] != null),
    );
  }

  /** Aggregates health checks from all registered plugins. */
  getHealthChecks(): PluginHealthCheck[] {
    return [...this.plugins.values()].flatMap((p) => p.getHealthChecks());
  }

  /** Shuts down every registered plugin. */
  async shutdownAll(): Promise<void> {
    await Promise.all(
      [...this.plugins.values()].map((p) => p.shutdown()),
    );
  }
}
