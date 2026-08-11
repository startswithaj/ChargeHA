import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import {
  createChargerConfigProcedures,
  createNetworkDiscoveryProcedures,
} from "../../../createPluginConfigProcedures.ts";
import { TAPO_SECRET_KEYS, tapoConfigDef } from "./config.ts";
import { discoverTapo } from "./TapoDiscovery.ts";
import { KlapClient } from "./KlapClient.ts";
import type { TapoDeviceInfo, TapoEnergyUsage } from "./TapoChargerAdapter.ts";
import type { TapoChargerPlugin } from "./TapoChargerPlugin.ts";

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  email: z.string(),
  password: z.string(),
});

// Which charger row to act on. `chargerRowId`, not `chargerId`, because a
// Tapo row has no device-side id and the two would be easy to confuse.
const chargerInput = z.object({
  chargerRowId: z.string(),
});

const setPowerInput = z.object({
  chargerRowId: z.string(),
  on: z.boolean(),
});

// A client for the plug configured on ONE charger row. Two Tapo rows resolve
// to two different plugs; there is no "the" saved plug any more.
async function savedClient(
  deps: PluginDependencies,
  chargerRowId: string,
): Promise<KlapClient> {
  const { config, secrets } = await deps.resolveChargerConfig(chargerRowId);
  const { host, email } = config;
  const password = secrets.password;
  if (!host || !email || !password) {
    throw new Error("Tapo plug not configured");
  }
  return new KlapClient(
    host,
    email,
    password,
    deps.log,
    deps.dbLog,
    chargerRowId,
  );
}

export function createTapoRouter(
  deps: PluginDependencies,
  plugin: Pick<TapoChargerPlugin, "testConnection">,
) {
  return router({
    ...createChargerConfigProcedures(deps, tapoConfigDef, TAPO_SECRET_KEYS),
    ...createNetworkDiscoveryProcedures(deps),

    discover: publicProcedure
      .input(discoverInput)
      .mutation(async ({ input }) => {
        const found = await discoverTapo(deps.log, input.subnet);
        return { found };
      }),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) => plugin.testConnection(input)),

    // Wizard verify step: toggle the saved plug and read live power.
    setPower: publicProcedure
      .input(setPowerInput)
      .mutation(async ({ input }) => {
        const client = await savedClient(deps, input.chargerRowId);
        await client.request("set_device_info", { device_on: input.on });
        return { on: input.on };
      }),

    status: publicProcedure
      .input(chargerInput)
      .query(async ({ input }) => {
        const client = await savedClient(deps, input.chargerRowId);
        // Sequential — same one-request-at-a-time rule as the adapter.
        const info = await client.request<TapoDeviceInfo>("get_device_info");
        const energy = await client.request<TapoEnergyUsage>(
          "get_energy_usage",
        );
        return {
          on: info.device_on,
          powerW: energy.current_power / 1000,
          model: info.model,
        };
      }),
  });
}
