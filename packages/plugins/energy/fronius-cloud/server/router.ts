import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";

// ── Typed Zod schema for Fronius Cloud plugin procedure ─────────────────────

const testConnectionInput = z.object({
  email: z.string(),
  password: z.string(),
  pvSystemId: z.string(),
});

// ── Fronius Cloud plugin tRPC router ────────────────────────────────────────

export const froniusCloudRouter = router({
  ...createPluginConfigProcedures(
    "fronius_cloud",
    froniusCloudConfigDef,
    FRONIUS_CLOUD_SECRET_KEYS,
  ),

  testConnection: publicProcedure
    .input(testConnectionInput)
    .mutation(async ({ input }) => {
      const adapter = new FroniusCloudAdapter(
        input.email,
        input.password,
        input.pvSystemId,
        new Logger("FroniusCloud", "error"),
      );
      try {
        await adapter.connect();
        const deviceInfo = await adapter.getDeviceInfo();
        await adapter.disconnect();
        return { success: true as const, systemName: deviceInfo.name };
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err.message : "Connection failed",
        };
      }
    }),
});
