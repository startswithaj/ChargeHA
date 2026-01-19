import { publicProcedure, router } from "../trpc.ts";
import { energyHistoryInput } from "@chargeha/shared/schemas";

export const energyRouter = router({
  // Returns registered energy plugins for dynamic UI rendering
  getPlugins: publicProcedure.query(({ ctx }) => {
    return ctx.energyManager.getPluginSummaries();
  }),

  // Returns latest energy snapshot from poller
  realtime: publicProcedure.query(({ ctx }) => {
    return ctx.poller.getRealtimeSnapshot();
  }),

  // Returns recent energy readings from DB
  history: publicProcedure
    .input(energyHistoryInput)
    .query(({ ctx, input }) => {
      return ctx.energyManager.getRecentReadings(input.limit);
    }),
});
