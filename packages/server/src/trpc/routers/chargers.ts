import { z } from "zod";
import { publicProcedure, router } from "../trpc.ts";
import { createTraceId } from "@chargeha/shared";

const idInput = z.object({ id: z.string() });
const modeInput = z.object({
  id: z.string(),
  mode: z.enum(["auto", "charge_now", "stop"]),
});
const priorityInput = z.object({
  order: z.array(z.string()), // charger ids in priority order
});
const createInput = z.object({
  name: z.string(),
  chargerAdapterType: z.string(),
});
const ensureInput = z.object({ chargerAdapterType: z.string() });
const setAmpsInput = z.object({ id: z.string(), amps: z.number().int() });

export const chargersRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return await ctx.chargingPointManager.getChargersWithState();
  }),

  create: publicProcedure.input(createInput).mutation(
    async ({ ctx, input }) => {
      return await ctx.chargingPointManager.createCharger(input);
    },
  ),

  ensure: publicProcedure.input(ensureInput).mutation(
    async ({ ctx, input }) => {
      await ctx.chargingPointManager.ensureCharger(input.chargerAdapterType);
    },
  ),

  setAmps: publicProcedure.input(setAmpsInput).mutation(
    async ({ ctx, input }) => {
      const state = ctx.chargingPointManager.getState(input.id);
      if (!state) return { success: false as const };
      const result = await ctx.chargingPointManager.startChargingAt(
        input.id,
        input.amps,
        { origin: "user:set-amps", traceId: createTraceId() },
        state,
        { force: true },
      );
      return { success: result.success };
    },
  ),

  setMode: publicProcedure.input(modeInput).mutation(async ({ ctx, input }) => {
    await ctx.chargingPointManager.setMode(input.id, input.mode, {
      origin: "user:set-mode",
      traceId: createTraceId(),
    });
  }),

  reorder: publicProcedure.input(priorityInput).mutation(
    async ({ ctx, input }) => {
      await ctx.chargingPointManager.reorder(input.order);
    },
  ),

  remove: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.chargingPointManager.deleteCharger(input.id);
  }),
});
