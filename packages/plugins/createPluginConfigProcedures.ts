import { z } from "zod";
import {
  buildSectionInputSchema,
  deserializeSection,
  sectionDbKeys,
  serializeSection,
} from "@chargeha/shared/configSections";
import type { SectionDef } from "@chargeha/shared/configSections";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { publicProcedure } from "../server/src/trpc/trpc.ts";

/**
 * Creates reusable getConfig/setConfig tRPC procedures for a plugin.
 *
 * Each plugin spreads these into its own router so config I/O lives on
 * the plugin's own tRPC path (e.g. trpc.plugin.vehicle.tesla.getConfig)
 * instead of a centralized pluginConfig router with hardcoded pluginId
 * strings. All storage goes through the plugin's own deps — configDef keys
 * are relative (e.g. "client_id") and deps prefixes them with the plugin id,
 * the single place namespacing happens.
 *
 * No reconfigure callback: `AppDatabase.setConfig` / `storeSecret` emit
 * `config_changed` events, and subscribers (e.g. EnergyPoller) drive any
 * adapter rebuild + timer restart themselves. Secret encryption is
 * encapsulated inside AppDatabase, so this helper never touches the
 * encryption key directly.
 */
export function createPluginConfigProcedures(
  deps: PluginDependencies,
  configDef: SectionDef,
  secretKeys: readonly string[],
) {
  const secretKeySet = new Set<string>(secretKeys);
  const dbKeys = sectionDbKeys(configDef);
  const inputSchema = buildSectionInputSchema(configDef);

  return {
    getConfig: publicProcedure.query(async () => {
      const entries = await Promise.all(
        dbKeys.map(async (key) => {
          const value = secretKeySet.has(key)
            ? await deps.getSecret(key)
            : await deps.getConfig(key);
          return [key, value] as const;
        }),
      );
      return deserializeSection(configDef, Object.fromEntries(entries));
    }),

    setConfig: publicProcedure
      .input(z.record(z.string(), z.unknown()))
      .mutation(async ({ input }) => {
        const validated = inputSchema.parse(input);
        const kvPairs = serializeSection(configDef, validated);

        await Promise.all(
          Object.entries(kvPairs).map(([key, value]) =>
            secretKeySet.has(key)
              ? deps.setSecret(key, value)
              : deps.setConfig(key, value)
          ),
        );

        deps.log.info("Plugin config updated");
      }),
  };
}
