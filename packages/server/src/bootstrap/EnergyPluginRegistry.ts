import type { AnyRouter } from "@trpc/server";
import type { EnergyPlugin } from "@chargeha/plugins/types";

/**
 * Thin container for energy plugins. Starts empty; plugins are constructed
 * and passed in via `register()`. Plugins initialize themselves in their own
 * constructors, so the registry does not own lifecycle concerns beyond
 * collection + shutdown aggregation.
 */
export class EnergyPluginRegistry {
  private readonly plugins = new Map<string, EnergyPlugin>();

  register(plugin: EnergyPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Duplicate energy plugin id: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): EnergyPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): EnergyPlugin[] {
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

  /** Shuts down every registered plugin. */
  async shutdownAll(): Promise<void> {
    await Promise.all(
      [...this.plugins.values()].map((p) => p.shutdown()),
    );
  }
}
