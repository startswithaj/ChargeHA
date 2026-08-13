import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createSimulatedChargerRouter } from "./server/router.ts";

export type SimulatedChargerAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    Record<string, never>,
    { simulated_charger: ReturnType<typeof createSimulatedChargerRouter> }
  >
>;
