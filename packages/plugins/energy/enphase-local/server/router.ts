import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { discoverEnphase } from "./EnphaseDiscovery.ts";
import { ENPHASE_LOCAL_SECRET_KEYS, enphaseLocalConfigDef } from "./config.ts";
import {
  createNetworkDiscoveryProcedures,
  createPluginConfigProcedures,
} from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnphaseLocalPlugin } from "./EnphaseLocalPlugin.ts";

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  email: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
});

export function createEnphaseLocalRouter(
  deps: PluginDependencies,
  plugin: Pick<EnphaseLocalPlugin, "testConnection">,
) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      enphaseLocalConfigDef,
      ENPHASE_LOCAL_SECRET_KEYS,
    ),
    ...createNetworkDiscoveryProcedures(deps),

    discover: publicProcedure
      .input(discoverInput)
      .mutation(async ({ input }) => {
        const found = await discoverEnphase(deps.log, input.subnet);
        return { found };
      }),

    // End-to-end connection test: fingerprints via /info and returns the serial plus any owner token.
    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) => plugin.testConnection(input)),
  });
}
