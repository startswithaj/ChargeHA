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
      const tz = input.tz ?? 0;
      const detailed = input.resolution === "15m";
      return ctx.statsService.buildDayStats(
        input.date,
        tz,
        input.vehicleId,
        detailed,
      );
    }),

  month: publicProcedure
    .input(statsMonthInput)
    .query(({ ctx, input }) => {
      const tz = input.tz ?? 0;
      return ctx.statsService.buildMonthStats(
        input.year,
        input.month,
        tz,
        input.vehicleId,
      );
    }),

  year: publicProcedure
    .input(statsYearInput)
    .query(({ ctx, input }) => {
      const tz = input.tz ?? 0;
      return ctx.statsService.buildYearStats(
        input.year,
        tz,
        input.vehicleId,
      );
    }),
});
