import { TRPCError } from "@trpc/server";
import {
  authAuthorizeInput,
  authSelectVehicleInput,
  authSelectVehiclesInput,
  wizardImportKeysInput,
} from "@chargeha/shared/schemas";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { TeslaVehiclePlugin } from "./index.ts";
import { TESLA_SECRET_KEYS, teslaConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";

async function collectProxyWarnings(
  plugin: TeslaVehiclePlugin,
): Promise<string[]> {
  const checks = plugin.getHealthChecks();
  const results = await Promise.all(checks.map(async (c) => ({
    check: c,
    result: await c.run(),
  })));
  return results
    .filter(({ result }) => result.status !== "ok")
    .map(({ check, result }) =>
      result.message ?? check.warningMessage ?? `${check.name} check failed`
    );
}

export function createTeslaRouter(
  plugin: TeslaVehiclePlugin,
  deps: PluginDependencies,
) {
  return router({
    ...createPluginConfigProcedures(deps, teslaConfigDef, TESLA_SECRET_KEYS),

    teslaStatus: publicProcedure.query(() => {
      return plugin.teslaTokenManager.getStatus();
    }),

    teslaVehicles: publicProcedure.query(() => {
      return plugin.teslaService.listFleetVehicles();
    }),

    listVehicles: publicProcedure.query(async () => {
      return { vehicles: await deps.getVehiclesWithState() };
    }),

    encryptionStatus: publicProcedure.query(() => {
      return { configured: deps.encryptionConfigured() };
    }),

    proxyHealth: publicProcedure.query(async () => {
      return { warnings: await collectProxyWarnings(plugin) };
    }),

    getAuthUrl: publicProcedure
      .input(authAuthorizeInput)
      .mutation(async ({ input }) => {
        const state = crypto.randomUUID();
        const url = await plugin.teslaTokenManager
          .getAuthorizationUrl(state, input.origin);
        return { url, state };
      }),

    resetOnboarding: publicProcedure.mutation(() => {
      return plugin.teslaService.resetOnboarding();
    }),

    selectVehicle: publicProcedure
      .input(authSelectVehicleInput)
      .mutation(({ input }) => {
        return plugin.teslaService.selectVehicle(input);
      }),

    selectVehicles: publicProcedure
      .input(authSelectVehiclesInput)
      .mutation(({ input }) => {
        return plugin.teslaService.selectVehicles(input);
      }),

    checkKeyPairing: publicProcedure.mutation(async () => {
      const result = await plugin.teslaService.checkKeyPairing();
      if (result.paired === null && result.error?.includes("No Tesla")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error,
        });
      }
      return result;
    }),

    generateKeys: publicProcedure.mutation(() => {
      return plugin.generateKeys();
    }),

    importKeys: publicProcedure
      .input(wizardImportKeysInput)
      .mutation(({ input }) => {
        return plugin.importKeys(input);
      }),

    registerPartner: publicProcedure.mutation(() => {
      return plugin.teslaService.registerPartner();
    }),

    // ── Tunnel (host infrastructure reached via the plugin API) ───────────

    tunnelStatus: publicProcedure.query(() => {
      const url = deps.tunnel.getUrl();
      return { active: url !== null, url };
    }),

    startTunnel: publicProcedure.mutation(async () => {
      try {
        return await deps.tunnel.start();
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error
            ? err.message
            : "Failed to start tunnel",
          cause: err,
        });
      }
    }),

    stopTunnel: publicProcedure.mutation(async () => {
      await deps.tunnel.stop();
      return { stopped: true };
    }),
  });
}
