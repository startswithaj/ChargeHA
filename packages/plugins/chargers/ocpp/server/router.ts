import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import { OCPP_SECRET_KEYS, ocppConfigDef } from "./config.ts";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";

// Printable ASCII: goes through btoa for Basic Auth (throws on non-Latin1)
// and into the charger's AuthorizationKey config.
const setAuthKeyInput = z.object({
  key: z.string().min(8).regex(/^[\x21-\x7E]+$/, "Printable ASCII only"),
});

export function createOcppRouter(
  deps: PluginDependencies,
  centralSystem: OcppCentralSystem,
) {
  return router({
    ...createPluginConfigProcedures(deps, ocppConfigDef, OCPP_SECRET_KEYS),

    /** Connection status + charger info for settings/wizard live display. */
    status: publicProcedure.query(async () => {
      const data = centralSystem.getData();
      const chargerId = await deps.getConfig("charger_id");
      return {
        connected: data.connected,
        info: data.info,
        status: data.status,
        // Client composes ws://<location.hostname>:<port> + this path.
        // null until a charger id is configured (no empty-string sentinels).
        wsPath: chargerId ? `/api/charger/ocpp/${chargerId}` : null,
      };
    }),

    testConnection: publicProcedure.mutation(async () => {
      if (!centralSystem.getData().connected) {
        return {
          success: false as const,
          error: "Charger not connected — check the charger URL in its " +
            "OCPP settings and your network",
        };
      }
      try {
        const { latencyMs } = await centralSystem.ping();
        return { success: true as const, latencyMs };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Round trip failed",
        };
      }
    }),

    /** Security Profile 1 bootstrap: push the key to the charger via
     *  ChangeConfiguration, then store it — future connects must Basic Auth. */
    setAuthorizationKey: publicProcedure
      .input(setAuthKeyInput)
      .mutation(async ({ input }) => {
        const accepted = await centralSystem.changeConfiguration(
          "AuthorizationKey",
          input.key,
        );
        if (!accepted) {
          return {
            success: false as const,
            error: "Charger rejected the AuthorizationKey",
          };
        }
        await deps.setSecret("authorization_key", input.key);
        return { success: true as const };
      }),
  });
}
