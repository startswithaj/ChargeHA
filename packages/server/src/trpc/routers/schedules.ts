import { publicProcedure, router } from "../trpc.ts";
import {
  oneOffChargeCreateInput,
  scheduleCreateInput,
  scheduleDeleteInput,
  scheduleUpdateInput,
} from "@chargeha/shared/schemas";

export const schedulesRouter = router({
  // List all schedules
  list: publicProcedure.query(async ({ ctx }) => {
    return await ctx.scheduleService.list();
  }),

  // Get currently active schedules
  active: publicProcedure.query(async ({ ctx }) => {
    return await ctx.scheduleService.getActiveSchedules();
  }),

  // Create a new schedule
  create: publicProcedure
    .input(scheduleCreateInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.scheduleService.create(input);
    }),

  // Update a schedule
  update: publicProcedure
    .input(scheduleUpdateInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.scheduleService.update(input);
    }),

  // Delete a schedule
  delete: publicProcedure
    .input(scheduleDeleteInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.scheduleService.delete(input.id);
    }),

  // Schedule a one-off charge on the next occurrence of a start time
  createOneOff: publicProcedure
    .input(oneOffChargeCreateInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.scheduleService.createOneOff(input);
    }),
});
