import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { GOODWE_SEMS_SECRET_KEYS, goodweSemsConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { GoodweSemsPlugin } from "./GoodweSemsPlugin.ts";

// ── Typed Zod schemas for GoodWe SEMS plugin procedures ─────────────────────

const credentialsInput = z.object({
  account: z.string(),
  password: z.string(),
  useSemsPlus: z.boolean().optional(),
});

const testConnectionInput = credentialsInput.extend({
  stationId: z.string(),
});

// ── GoodWe SEMS plugin tRPC router ──────────────────────────────────────────
// Pure wiring: session handling and SEMS interaction live on the plugin.

export function createGoodweSemsRouter(
  deps: PluginDependencies,
  plugin: Pick<GoodweSemsPlugin, "listStations" | "testConnection">,
) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      goodweSemsConfigDef,
      GOODWE_SEMS_SECRET_KEYS,
    ),

    // Removes the manual station-ID paste — the wizard logs in, lists, and the
    // user picks.
    listStations: publicProcedure
      .input(credentialsInput)
      .mutation(({ input }) =>
        plugin.listStations(input.account, input.password, input.useSemsPlus)
      ),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) =>
        plugin.testConnection(
          input.account,
          input.password,
          input.stationId,
          input.useSemsPlus,
        )
      ),
  });
}
