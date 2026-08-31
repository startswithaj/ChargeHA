import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { discoverFronius } from "./FroniusDiscovery.ts";
import { froniusLocalConfigDef } from "./config.ts";
import {
  createNetworkDiscoveryProcedures,
  createPluginConfigProcedures,
} from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { FroniusLocalPlugin } from "./FroniusLocalPlugin.ts";

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  meterDeviceId: z.number().optional(),
});

export function createFroniusLocalRouter(
  deps: PluginDependencies,
  plugin: Pick<FroniusLocalPlugin, "testConnection">,
) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      froniusLocalConfigDef,
      [],
    ),
    ...createNetworkDiscoveryProcedures(deps),

    discover: publicProcedure
      .input(discoverInput)
      .mutation(async ({ input }) => {
        const found = await discoverFronius(deps.log, input.subnet);
        return { found };
      }),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) =>
        plugin.testConnection(input.host, input.meterDeviceId ?? 0)
      ),
  });
}
