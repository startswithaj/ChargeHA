import { publicProcedure, router } from "../trpc.ts";
import {
  defaultRateUpdateInput,
  tariffCreateInput,
  tariffDeleteInput,
  tariffPresetInput,
  tariffUpdateInput,
} from "@chargeha/shared/schemas";

export const tariffsRouter = router({
  // List all tariff periods + default rate
  list: publicProcedure.query(({ ctx }) => {
    return ctx.tariffService.list();
  }),

  // Get default rate + currency config
  defaultRate: publicProcedure.query(({ ctx }) => {
    return ctx.tariffService.getDefaultRate();
  }),

  // Get current active tariff rate
  currentRate: publicProcedure.query(({ ctx }) => {
    return ctx.tariffService.getCurrentRate();
  }),

  // Create a tariff period
  create: publicProcedure
    .input(tariffCreateInput)
    .mutation(({ ctx, input }) => {
      return ctx.tariffService.create(input);
    }),

  // Update a tariff period
  update: publicProcedure
    .input(tariffUpdateInput)
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      return ctx.tariffService.update(id, rest);
    }),

  // Delete a tariff period
  delete: publicProcedure
    .input(tariffDeleteInput)
    .mutation(({ ctx, input }) => {
      return ctx.tariffService.delete(input.id);
    }),

  // Update default rate + optional currency config
  updateDefaultRate: publicProcedure
    .input(defaultRateUpdateInput)
    .mutation(({ ctx, input }) => {
      return ctx.tariffService.updateDefaultRate(input);
    }),

  // Load a preset template
  loadPreset: publicProcedure
    .input(tariffPresetInput)
    .mutation(({ ctx, input }) => {
      return ctx.tariffService.loadPreset(input.template);
    }),
});
