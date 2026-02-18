import { TRPCError } from "@trpc/server";
import {
  authAuthorizeInput,
  authSelectVehicleInput,
  wizardImportKeysInput,
} from "@chargeha/shared/schemas";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { TrpcContext } from "../../../../server/src/trpc/trpc.ts";
import type { TeslaVehiclePlugin } from "./index.ts";
import { TESLA_SECRET_KEYS, teslaConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";

function getTeslaPlugin(ctx: TrpcContext): TeslaVehiclePlugin {
  const plugin = ctx.vehiclePlugins.get("tesla");
  if (!plugin) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Tesla plugin not registered",
    });
  }
  return plugin as TeslaVehiclePlugin;
}

export const teslaRouter = router({
  ...createPluginConfigProcedures("tesla", teslaConfigDef, TESLA_SECRET_KEYS),

  commandStatus: publicProcedure.query(async ({ ctx }) => {
    const plugin = getTeslaPlugin(ctx);

    const checks = plugin.getHealthChecks();
    const checkResults = checks.length > 0
      ? await Promise.all(checks.map((c) => c.run()))
      : [];
    const proxyOk = checkResults.every((r) => r.status === "ok") &&
      checks.length > 0;

    if (!proxyOk) {
      return {
        commandsDisabled: true,
        reason: "The Tesla command proxy is not running.",
      };
    }

    const status = await plugin.teslaTokenManager.getStatus();
    if (status.vehicleConfigured && status.keyPaired !== true) {
      return {
        commandsDisabled: true,
        reason:
          "Your vehicle's key pairing is incomplete — the key must be approved on the vehicle's touchscreen before commands can be sent.",
      };
    }

    return { commandsDisabled: false, reason: null };
  }),

  teslaStatus: publicProcedure.query(({ ctx }) => {
    return getTeslaPlugin(ctx).teslaTokenManager.getStatus();
  }),

  teslaVehicles: publicProcedure.query(({ ctx }) => {
    return getTeslaPlugin(ctx).teslaService.listFleetVehicles();
  }),

  getAuthUrl: publicProcedure
    .input(authAuthorizeInput)
    .mutation(async ({ ctx, input }) => {
      const state = crypto.randomUUID();
      const url = await getTeslaPlugin(ctx).teslaTokenManager
        .getAuthorizationUrl(state, input.origin);
      return { url, state };
    }),

  disconnect: publicProcedure.mutation(({ ctx }) => {
    return getTeslaPlugin(ctx).teslaService.disconnect();
  }),

  selectVehicle: publicProcedure
    .input(authSelectVehicleInput)
    .mutation(({ ctx, input }) => {
      return getTeslaPlugin(ctx).teslaService.selectVehicle(input);
    }),

  checkKeyPairing: publicProcedure.mutation(async ({ ctx }) => {
    const result = await getTeslaPlugin(ctx).teslaService.checkKeyPairing();
    if (result.paired === null && result.error?.includes("No Tesla")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.error,
      });
    }
    return result;
  }),

  generateKeys: publicProcedure.mutation(({ ctx }) => {
    return getTeslaPlugin(ctx).generateKeys();
  }),

  importKeys: publicProcedure
    .input(wizardImportKeysInput)
    .mutation(({ ctx, input }) => {
      return getTeslaPlugin(ctx).importKeys(input);
    }),

  registerPartner: publicProcedure.mutation(({ ctx }) => {
    return getTeslaPlugin(ctx).teslaService.registerPartner();
  }),
});
