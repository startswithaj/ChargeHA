import { z } from "zod";
import {
  buildSectionInputSchema,
  deserializeSection,
  sectionDbKeys,
  serializeSection,
  serializeSectionPatch,
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

const chargerGetConfigInput = z.object({ chargerRowId: z.string() });
const chargerSetConfigInput = z.object({
  chargerRowId: z.string().nullable(),
  values: z.record(z.string(), z.unknown()),
});

/**
 * Creates row-scoped getConfig/setConfig tRPC procedures for a charger
 * plugin — one row can own its own credentials, so two chargers of the same
 * adapter type never collide.
 *
 * `chargerRowId: null` on setConfig means no row yet: the mutation creates
 * one via `deps.createChargerRow()` before writing, so add-mode and the
 * wizard can submit once with nothing created before that submit.
 *
 * Secret/plain split is the same `secretKeys` allowlist as the plugin-wide
 * factory. `getConfig` merges `{...config, ...secrets}` before
 * `deserializeSection` — credentials the user typed are returned, not
 * hidden; only encryption at rest is the requirement.
 *
 * The two patches run sequentially, not under `Promise.all` — both
 * read-modify-write the same `chargers` row. After writing, `rebuildCharger`
 * is awaited so the mutation resolves only once the running middleware
 * reflects what was saved.
 */
export function createChargerConfigProcedures(
  deps: PluginDependencies,
  configDef: SectionDef,
  secretKeys: readonly string[],
) {
  const secretKeySet = new Set<string>(secretKeys);
  const inputSchema = buildSectionInputSchema(configDef);

  return {
    getConfig: publicProcedure
      .input(chargerGetConfigInput)
      .query(async ({ input }) => {
        const { config, secrets } = await deps.resolveChargerConfig(
          input.chargerRowId,
        );
        return deserializeSection(configDef, { ...config, ...secrets });
      }),

    setConfig: publicProcedure
      .input(chargerSetConfigInput)
      .mutation(async ({ input }) => {
        const validated = inputSchema.parse(input.values);
        const patch = serializeSectionPatch(configDef, validated);
        const plainPatch = Object.fromEntries(
          Object.entries(patch).filter(([key]) => !secretKeySet.has(key)),
        );
        const secretPatch = Object.fromEntries(
          Object.entries(patch).filter(([key]) => secretKeySet.has(key)),
        );

        const chargerRowId = input.chargerRowId ??
          (await deps.createChargerRow()).id;

        // Sequential — both read-modify-write the same `chargers` row.
        await deps.patchChargerConfig(chargerRowId, plainPatch);
        await deps.patchChargerSecrets(chargerRowId, secretPatch);
        await deps.rebuildCharger(chargerRowId);

        deps.log.info("Charger config updated");
        return { chargerRowId };
      }),
  };
}
