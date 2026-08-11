import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { GoodweSemsClient } from "./GoodweSemsClient.ts";
import { GoodweSemsAdapter } from "./GoodweSemsAdapter.ts";
import { GOODWE_SEMS_SECRET_KEYS, goodweSemsConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";

// ── Typed Zod schemas for GoodWe SEMS plugin procedures ─────────────────────

const credentialsInput = z.object({
  account: z.string(),
  password: z.string(),
});

const testConnectionInput = credentialsInput.extend({
  stationId: z.string(),
});

// ── GoodWe SEMS plugin tRPC router ──────────────────────────────────────────

export function createGoodweSemsRouter(deps: PluginDependencies) {
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
      .mutation(async ({ input }) => {
        const client = new GoodweSemsClient(
          input.account,
          input.password,
          deps.log,
          deps.dbLog,
        );
        deps.log.info("SEMS (ui) listStations requested");
        try {
          await client.login();
          const stations = await client.getStations();
          deps.log.info(
            `SEMS (ui) listStations → ${stations.length} station(s)`,
          );
          return { success: true as const, stations };
        } catch (err) {
          deps.log.warn(`SEMS (ui) listStations failed: ${err}`);
          return {
            success: false as const,
            error: err instanceof Error ? err.message : "Login failed",
          };
        }
      }),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(async ({ input }) => {
        const adapter = GoodweSemsAdapter.create(
          input.account,
          input.password,
          input.stationId,
          deps.log,
          deps.dbLog,
        );
        deps.log.info(
          `SEMS (ui) testConnection requested for station ${input.stationId}`,
        );
        try {
          await adapter.connect();
          const deviceInfo = await adapter.getDeviceInfo();
          await adapter.disconnect();
          deps.log.info(`SEMS (ui) testConnection ok — ${deviceInfo.name}`);
          return { success: true as const, systemName: deviceInfo.name };
        } catch (err) {
          deps.log.warn(`SEMS (ui) testConnection failed: ${err}`);
          return {
            success: false as const,
            error: err instanceof Error ? err.message : "Connection failed",
          };
        }
      }),
  });
}
