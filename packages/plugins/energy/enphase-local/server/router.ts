import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { EnphaseClient } from "./EnphaseClient.ts";
import { EnphaseLocalAdapter } from "./EnphaseLocalAdapter.ts";
import { discoverEnphase } from "./EnphaseDiscovery.ts";
import { ENPHASE_LOCAL_SECRET_KEYS, enphaseLocalConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";

// ── Typed Zod schemas for the Enphase plugin procedures ─────────────────────

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  serial: z.string(),
  email: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
});

// ── Enphase plugin tRPC router ──────────────────────────────────────────────

export const enphaseLocalRouter = router({
  ...createPluginConfigProcedures(
    "enphase_local",
    enphaseLocalConfigDef,
    ENPHASE_LOCAL_SECRET_KEYS,
  ),

  discover: publicProcedure
    .input(discoverInput)
    .mutation(async ({ ctx, input }) => {
      const found = await discoverEnphase(ctx.logger, input.subnet);
      return { found };
    }),

  // Validates the connection end-to-end. When credentials are supplied the
  // owner token fetched along the way is returned so the wizard can persist
  // it, saving a second cloud round-trip on first poll.
  testConnection: publicProcedure
    .input(testConnectionInput)
    .mutation(async ({ input }) => {
      const logger = new Logger("Enphase", "error");
      const fetchedTokens: string[] = [];
      const client = new EnphaseClient(
        input.host,
        input.serial,
        {
          email: input.email ?? "",
          password: input.password ?? "",
          manualToken: input.token ?? "",
          cachedToken: "",
        },
        (token) => {
          fetchedTokens.push(token);
          return Promise.resolve();
        },
        logger,
      );
      const adapter = new EnphaseLocalAdapter(client, logger);
      try {
        await adapter.connect();
        const [device, realtime] = await Promise.all([
          adapter.getDeviceInfo(),
          adapter.getRealtimeData(),
        ]);
        return {
          success: true as const,
          device,
          realtime,
          fetchedToken: fetchedTokens.at(-1) ?? null,
        };
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err.message : "Connection failed",
        };
      } finally {
        await adapter.disconnect();
      }
    }),
});
