import { publicProcedure, router } from "../trpc.ts";
import {
  statsDayInput,
  statsMonthInput,
  statsYearInput,
} from "@chargeha/shared/schemas";

export const statsRouter = router({
  day: publicProcedure
    .input(statsDayInput)
    .query(({ ctx, input }) => {
      const detailed = input.resolution === "15m";
      return ctx.statsService.buildDayStats(
        input.date,
        input.vehicleId,
        detailed,
      );
    }),

  month: publicProcedure
    .input(statsMonthInput)
    .query(({ ctx, input }) => {
      return ctx.statsService.buildMonthStats(
        input.year,
        input.month,
        input.vehicleId,
      );
    }),

  year: publicProcedure
    .input(statsYearInput)
    .query(({ ctx, input }) => {
      return ctx.statsService.buildYearStats(
        input.year,
        input.vehicleId,
      );
    }),
});
