import { publicProcedure, router } from "../trpc.ts";
import {
  vehicleCommandInput,
  vehicleCreateInput,
  vehicleIdInput,
  vehicleSetAmpsInput,
  vehicleSetModeInput,
  vehicleSetPriorityInput,
} from "@chargeha/shared/schemas";

export const vehiclesRouter = router({
  // Returns registered vehicle plugins for dynamic UI rendering
  getPlugins: publicProcedure.query(async ({ ctx }) => {
    return await ctx.vehicleService.getPluginSummaries();
  }),

  // Check command readiness for a specific vehicle, delegating to its plugin
  commandStatus: publicProcedure
    .input(vehicleIdInput)
    .query(async ({ ctx, input }) => {
      return await ctx.vehicleService.getCommandStatus(input.vehicleId);
    }),

  // List all configured vehicles with latest state
  list: publicProcedure.query(async ({ ctx }) => {
    const vehicles = await ctx.vehicleService.listVehicles();
    return { vehicles };
  }),

  // Create a new vehicle
  create: publicProcedure
    .input(vehicleCreateInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.vehicleService.createVehicle(input);
    }),

  // Delete a vehicle
  delete: publicProcedure
    .input(vehicleIdInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.vehicleService.deleteVehicle(input.vehicleId);
    }),

  // Set vehicle mode (auto/charge_now/stop)
  setMode: publicProcedure
    .input(vehicleSetModeInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.vehicleService.setMode(input.vehicleId, input.mode);
    }),

  // Set vehicle priority
  setPriority: publicProcedure
    .input(vehicleSetPriorityInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.vehicleService.setPriority(
        input.vehicleId,
        input.priority,
      );
    }),

  // Execute a vehicle command (start/stop/wake)
  command: publicProcedure
    .input(vehicleCommandInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.vehicleService.executeCommand(
        input.vehicleId,
        input.command,
      );
    }),

  // Set charging amps
  setAmps: publicProcedure
    .input(vehicleSetAmpsInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.vehicleService.setAmps(input.vehicleId, input.amps);
    }),

  // Force-poll vehicle for fresh state
  refreshState: publicProcedure
    .input(vehicleIdInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.vehicleService.refreshState(input.vehicleId);
    }),
});
