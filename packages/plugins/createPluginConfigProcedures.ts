import { z } from "zod";
import {
  buildSectionInputSchema,
  deserializeSection,
  sectionDbKeys,
  serializeSection,
} from "@chargeha/shared/configSections";
import type { SectionDef } from "@chargeha/shared/configSections";
import { publicProcedure } from "../server/src/trpc/trpc.ts";

/**
 * Creates reusable getConfig/setConfig tRPC procedures for a plugin.
 *
 * Each plugin spreads these into its own router so config I/O lives on
 * the plugin's own tRPC path (e.g. trpc.tesla.getConfig) instead of a
 * centralized pluginConfig router with hardcoded pluginId strings.
 *
 * No reconfigure callback: `AppDatabase.setConfig` / `storeSecret` emit
 * `config_changed` events, and subscribers (e.g. EnergyPoller) drive any
 * adapter rebuild + timer restart themselves. Secret encryption is
 * encapsulated inside AppDatabase, so this helper never touches the
 * encryption key directly.
 */
export function createPluginConfigProcedures(
  pluginId: string,
  configDef: SectionDef,
  secretKeys: readonly string[],
) {
  const secretKeySet = new Set<string>(secretKeys);
  const dbKeys = sectionDbKeys(configDef);
  const inputSchema = buildSectionInputSchema(configDef);

  return {
    getConfig: publicProcedure.query(async ({ ctx }) => {
      const entries = await Promise.all(
        dbKeys.map(async (key) => {
          const value = secretKeySet.has(key)
            ? await ctx.db.readSecret(key)
            : await ctx.db.getPluginConfig(key);
          return [key, value] as const;
        }),
      );
      return deserializeSection(configDef, Object.fromEntries(entries));
    }),

    setConfig: publicProcedure
      .input(z.record(z.string(), z.unknown()))
      .mutation(async ({ ctx, input }) => {
        const validated = inputSchema.parse(input);
        const kvPairs = serializeSection(configDef, validated);

        await Promise.all(
          Object.entries(kvPairs).map(([key, value]) =>
            secretKeySet.has(key)
              ? ctx.db.storeSecret(key, value)
              : ctx.db.setPluginConfig(key, value)
          ),
        );

        ctx.logger.info(`Plugin "${pluginId}" config updated`);
      }),
  };
}
