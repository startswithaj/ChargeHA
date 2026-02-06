import { publicProcedure, router } from "../trpc.ts";
import {
  chargeControllerLogsInput,
  logsPaginationInput,
  pluginLogsInput,
  vehicleUpdatesLogsInput,
} from "@chargeha/shared/schemas";

export const logsRouter = router({
  chargeController: publicProcedure
    .input(chargeControllerLogsInput)
    .query(async ({ ctx, input }) => {
      return await ctx.logService.getControllerLogs(input);
    }),

  energyReads: publicProcedure
    .input(logsPaginationInput)
    .query(async ({ ctx, input }) => {
      return await ctx.logService.getEnergyReadings(input);
    }),

  vehicleUpdates: publicProcedure
    .input(vehicleUpdatesLogsInput)
    .query(async ({ ctx, input }) => {
      return await ctx.logService.getVehicleUpdates(input);
    }),

  pluginLogs: publicProcedure
    .input(pluginLogsInput)
    .query(async ({ ctx, input }) => {
      return await ctx.logService.getPluginLogs(input);
    }),
});
