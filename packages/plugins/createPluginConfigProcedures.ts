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

// Reusable getConfig/setConfig tRPC procedures for a plugin — deps prefixes
// relative configDef keys with the plugin id. No reconfigure callback:
// AppDatabase's config_changed events drive any adapter rebuild themselves.
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

        const entries = Object.entries(kvPairs);
        const plain = Object.fromEntries(
          entries.filter(([key]) => !secretKeySet.has(key)),
        );
        const secrets = Object.fromEntries(
          entries.filter(([key]) => secretKeySet.has(key)),
        );
        // One atomic write: every key lands before config_changed fires, so
        // the adapter rebuild never reads a half-applied save.
        await deps.setConfigValues(plain, secrets);

        deps.log.info("Plugin config updated");
      }),
  };
}

// The `lanSubnets` query every discovery-capable plugin spreads into its
// router so the "Search Network" subnet field can default to where ChargeHA
// itself runs. Interface detection it calls lives in PluginDependencies.lanSubnets.
export function createNetworkDiscoveryProcedures(deps: PluginDependencies) {
  return {
    lanSubnets: publicProcedure.query(() => deps.lanSubnets()),
  };
}

const dropNulls = (patch: Record<string, string | null>) =>
  Object.fromEntries(
    Object.entries(patch).filter((entry): entry is [string, string] =>
      entry[1] !== null
    ),
  );

const chargerGetConfigInput = z.object({ chargerRowId: z.string() });
const chargerSetConfigInput = z.object({
  chargerRowId: z.string().nullable(),
  values: z.record(z.string(), z.unknown()),
  // The device's own name, where the wizard has already reached it. Used
  // only when creating the row — an existing row keeps the name it has.
  name: z.string().min(1).optional(),
});

// Row-scoped getConfig/setConfig for a charger plugin — one row owns its own
// credentials, so two chargers of the same type never collide.
// `chargerRowId: null` on setConfig means no row yet: creates one first.
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

        // Add mode is one insert: a failure between two writes would leave a
        // row holding its config but not its credentials.
        if (input.chargerRowId === null) {
          const row = await deps.createChargerRow({
            name: input.name,
            config: dropNulls(plainPatch),
            secrets: dropNulls(secretPatch),
          });
          deps.log.info("Charger created");
          return { chargerRowId: row.id };
        }

        // Sequential — both read-modify-write the same `chargers` row.
        const chargerRowId = input.chargerRowId;
        await deps.patchChargerConfig(chargerRowId, plainPatch);
        await deps.patchChargerSecrets(chargerRowId, secretPatch);
        await deps.rebuildCharger(chargerRowId);

        deps.log.info("Charger config updated");
        return { chargerRowId };
      }),
  };
}
