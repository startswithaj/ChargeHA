import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTraceId } from "@chargeha/shared";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { SimulatedVehiclePlugin } from "./index.ts";

export function createSimulatedRouter(
  plugin: SimulatedVehiclePlugin,
  deps: PluginDependencies,
) {
  return router({
    listVehicles: publicProcedure.query(async () => {
      return { vehicles: await deps.getVehiclesWithState() };
    }),

    geocode: publicProcedure
      .input(z.object({ q: z.string() }))
      .query(({ input }) => deps.geocode(input.q)),

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
      .mutation(async ({ input }) => {
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

        // Force a middleware cache refresh — the dashboard reads getCachedState(), not the adapter.
        const state = await deps.requestVehicleState(input.vehicleId, {
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
}
