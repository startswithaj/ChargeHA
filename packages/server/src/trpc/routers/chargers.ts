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
// Always creates a new row of this type — the name is resolved server-side
// from the plugin's displayName, with a distinguishing count appended for a
// second (or later) row of the same type. See ChargingPointManager.createChargerForType.
const createInput = z.object({ chargerAdapterType: z.string() });
const setAmpsInput = z.object({ id: z.string(), amps: z.number().int() });
const vehicleControlInput = z.object({
  vehicleId: z.string(),
  active: z.boolean(),
});
// `vehicleId: null` clears the assignment, returning resolution to
// inference — never an empty string.
const setVehicleIdInput = z.object({
  id: z.string(),
  vehicleId: z.string().nullable(),
});

export const chargersRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return await ctx.chargingPointManager.getChargersWithState();
  }),

  create: publicProcedure.input(createInput).mutation(
    async ({ ctx, input }) => {
      return await ctx.chargingPointManager.createChargerForType(
        input.chargerAdapterType,
      );
    },
  ),

  // Find-or-create by adapter type: safe for the wizard to repeat on
  // Back/Next, unlike create, which mints a new row every call.
  ensure: publicProcedure.input(createInput).mutation(
    async ({ ctx, input }) => {
      return await ctx.chargingPointManager.ensureCharger(
        input.chargerAdapterType,
      );
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

  setVehicleControl: publicProcedure.input(vehicleControlInput).mutation(
    async ({ ctx, input }) => {
      await ctx.chargingPointManager.setVehicleApiControl(
        input.vehicleId,
        input.active,
      );
    },
  ),

  setVehicleId: publicProcedure.input(setVehicleIdInput).mutation(
    async ({ ctx, input }) => {
      await ctx.chargingPointManager.setChargerVehicleId(
        input.id,
        input.vehicleId,
      );
    },
  ),
});
