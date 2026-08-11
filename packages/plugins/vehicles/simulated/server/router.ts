import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { SimulatedVehiclePlugin } from "./SimulatedVehiclePlugin.ts";

export function createSimulatedRouter(
  plugin: Pick<SimulatedVehiclePlugin, "updateState">,
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
        const result = await plugin.updateState(input);
        if (!result) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Simulated vehicle not found",
          });
        }
        return { success: true, state: result.state };
      }),
  });
}
