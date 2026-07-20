import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createSimulatedEnergyRouter } from "./server/router.ts";

export type SimulatedEnergyAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { simulated_energy: ReturnType<typeof createSimulatedEnergyRouter> }
  >
>;
