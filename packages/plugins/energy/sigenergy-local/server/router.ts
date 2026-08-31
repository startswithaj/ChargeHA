import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { discoverSigenergy } from "./SigenergyDiscovery.ts";
import { SIGENERGY_DEFAULTS, sigenergyLocalConfigDef } from "./config.ts";
import {
  createNetworkDiscoveryProcedures,
  createPluginConfigProcedures,
} from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { SigenergyLocalPlugin } from "./SigenergyLocalPlugin.ts";

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  port: z.number().default(SIGENERGY_DEFAULTS.port),
  plantUnitId: z.number().default(SIGENERGY_DEFAULTS.plantUnitId),
  deviceUnitId: z.number().default(SIGENERGY_DEFAULTS.deviceUnitId),
});

export function createSigenergyLocalRouter(
  deps: PluginDependencies,
  plugin: Pick<SigenergyLocalPlugin, "testConnection">,
) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      sigenergyLocalConfigDef,
      [],
    ),
    ...createNetworkDiscoveryProcedures(deps),

    discover: publicProcedure
      .input(discoverInput)
      .mutation(async ({ input }) => {
        const found = await discoverSigenergy(deps.log, input.subnet);
        return { found };
      }),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) => plugin.testConnection(input)),
  });
}
