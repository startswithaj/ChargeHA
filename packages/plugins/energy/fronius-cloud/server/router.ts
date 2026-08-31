import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { FroniusCloudPlugin } from "./FroniusCloudPlugin.ts";

// ── Typed Zod schema for Fronius Cloud plugin procedure ─────────────────────

const testConnectionInput = z.object({
  email: z.string(),
  password: z.string(),
  pvSystemId: z.string(),
});

// ── Fronius Cloud plugin tRPC router ────────────────────────────────────────

export function createFroniusCloudRouter(
  deps: PluginDependencies,
  plugin: Pick<FroniusCloudPlugin, "testConnection">,
) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      froniusCloudConfigDef,
      FRONIUS_CLOUD_SECRET_KEYS,
    ),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) =>
        plugin.testConnection(input.email, input.password, input.pvSystemId)
      ),
  });
}
