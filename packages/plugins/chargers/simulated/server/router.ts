import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { SimulatedChargerAdapter } from "./SimulatedChargerAdapter.ts";

const updateInput = z.object({
  chargerRowId: z.string(),
  pluggedIn: z.boolean().optional(),
  carMaxAmps: z.number().int().min(0).max(48).optional(),
});

export function createSimulatedChargerRouter(
  getAdapters: () => SimulatedChargerAdapter[],
) {
  return router({
    updateState: publicProcedure.input(updateInput).mutation(({ input }) => {
      const { chargerRowId, ...patch } = input;
      getAdapters().find((a) => a.chargerId === chargerRowId)
        ?.updateState(patch);
    }),
    status: publicProcedure.query(() =>
      getAdapters().map((adapter) => adapter.devStatus())
    ),
  });
}
