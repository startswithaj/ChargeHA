import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { EnphaseClient, makeNodeHttpsEnvoyHttp } from "./EnphaseClient.ts";
import { INFO_PATH, isEnvoyInfo, tagValue } from "./envoyInfo.ts";
import { EnphaseLocalAdapter } from "./EnphaseLocalAdapter.ts";
import { discoverEnphase } from "./EnphaseDiscovery.ts";
import { ENPHASE_LOCAL_SECRET_KEYS, enphaseLocalConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import { PluginDbLogger } from "../../../PluginDbLogger.ts";

// ── Typed Zod schemas for the Enphase plugin procedures ─────────────────────

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
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

  // Validates the connection end-to-end. The host is first fingerprinted via
  // the unauthenticated /info, whose serial is returned for display. When
  // credentials are supplied the owner token fetched along the way is also
  // returned so the wizard can persist it, saving a second cloud round-trip
  // on first poll.
  testConnection: publicProcedure
    .input(testConnectionInput)
    .mutation(async ({ input }) => {
      const logger = new Logger("Enphase", "error");
      try {
        const info = await makeNodeHttpsEnvoyHttp().get(
          input.host,
          INFO_PATH,
          {},
        );
        if (info.status !== 200 || !isEnvoyInfo(info.body)) {
          return {
            success: false as const,
            error: `No Enphase Envoy found at ${input.host}`,
          };
        }
        const serial = tagValue(info.body, "sn");
        const fetchedTokens: string[] = [];
        const client = new EnphaseClient(
          input.host,
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
        // Connection tests are interactive — results go back to the caller,
        // so nothing is persisted to the plugin log.
        const noopDbLog = new PluginDbLogger(() => Promise.resolve(), logger);
        const adapter = new EnphaseLocalAdapter(client, logger, noopDbLog);
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
            serial,
            fetchedToken: fetchedTokens.at(-1) ?? null,
          };
        } finally {
          await adapter.disconnect();
        }
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err.message : "Connection failed",
        };
      }
    }),
});
