import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { discoverFronius } from "./discovery.ts";
import { FroniusLocalAdapter } from "./FroniusLocalAdapter.ts";
import { froniusLocalConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";

// ── Typed Zod schemas for Fronius Local plugin procedures ───────────────────

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  meterDeviceId: z.number().optional(),
});

// ── Fronius Local plugin tRPC router ────────────────────────────────────────

export const froniusLocalRouter = router({
  ...createPluginConfigProcedures("fronius_local", froniusLocalConfigDef, []),

  discover: publicProcedure
    .input(discoverInput)
    .mutation(async ({ ctx, input }) => {
      const found = await discoverFronius(ctx.logger, input.subnet);
      return { found };
    }),

  testConnection: publicProcedure
    .input(testConnectionInput)
    .mutation(async ({ input }) => {
      const adapter = new FroniusLocalAdapter(
        input.host,
        input.meterDeviceId ?? 0,
        new Logger("Fronius", "error"),
      );
      try {
        await adapter.connect();
        const [device, realtime] = await Promise.all([
          adapter.getDeviceInfo(),
          adapter.getRealtimeData(),
        ]);
        return { success: true as const, device, realtime };
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err.message : "Connection failed",
        };
      }
    }),
});
