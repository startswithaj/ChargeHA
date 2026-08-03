import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { SimulatedChargerAdapter } from "./SimulatedChargerAdapter.ts";

const updateInput = z.object({
  pluggedIn: z.boolean().optional(),
  carMaxAmps: z.number().int().min(0).max(48).optional(),
});

export function createSimulatedChargerRouter(
  getAdapters: () => SimulatedChargerAdapter[],
) {
  return router({
    updateState: publicProcedure.input(updateInput).mutation(({ input }) => {
      getAdapters().forEach((adapter) => adapter.updateState(input));
    }),
    status: publicProcedure.query(() =>
      getAdapters().map((adapter) => adapter.devStatus())
    ),
  });
}
