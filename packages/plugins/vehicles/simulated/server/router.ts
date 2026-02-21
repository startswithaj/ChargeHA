import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTraceId } from "@chargeha/shared";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { TrpcContext } from "../../../../server/src/trpc/trpc.ts";
import type { SimulatedVehiclePlugin } from "./index.ts";

function getSimulatedPlugin(ctx: TrpcContext): SimulatedVehiclePlugin {
  const plugin = ctx.vehiclePlugins.get("simulated");
  if (!plugin) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Simulated plugin not registered",
    });
  }
  return plugin as SimulatedVehiclePlugin;
}

export const simulatedRouter = router({
  updateState: publicProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        isPluggedIn: z.boolean().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        chargeLimit: z.number().optional(),
        socPercent: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plugin = getSimulatedPlugin(ctx);
      const adapter = plugin.getAdapter(input.vehicleId);
      if (!adapter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Simulated vehicle not found",
        });
      }

      if (typeof input.isPluggedIn === "boolean") {
        adapter.setPluggedIn(input.isPluggedIn);
      }

      if (
        typeof input.latitude === "number" &&
        typeof input.longitude === "number"
      ) {
        adapter.setLocation(input.latitude, input.longitude);
      }

      if (typeof input.chargeLimit === "number") {
        await adapter.setChargeLimit(
          input.chargeLimit,
          { origin: "user:sim-set-charge-limit", traceId: createTraceId() },
        );
      }

      if (typeof input.socPercent === "number") {
        const clamped = Math.max(0, Math.min(100, input.socPercent));
        adapter.setSocPercent(clamped);
      }

      // Refresh middleware cache so vehicle.list reflects the override.
      // adapter.setX() updates the adapter, but the dashboard reads
      // middleware.getCachedState() — without forceRefresh the cache
      // keeps returning pre-override values.
      const state = await ctx.vehicleManager.requestState(input.vehicleId, {
        origin: "user:sim-update",
        traceId: createTraceId(),
        hasSolar: false,
        hasSchedule: false,
        hasBlockout: false,
        forceRefresh: true,
      });
      return { success: true, state };
    }),
});
