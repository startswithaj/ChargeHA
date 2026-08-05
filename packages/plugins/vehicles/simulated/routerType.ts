import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createSimulatedRouter } from "./server/router.ts";

export type SimulatedAppRouter = ReturnType<
  typeof createAppRouter<
    { simulated: ReturnType<typeof createSimulatedRouter> },
    Record<string, never>,
    Record<string, never>
  >
>;

export type SimulatedDataOnlyAppRouter = ReturnType<
  typeof createAppRouter<
    { simulated_dataonly: ReturnType<typeof createSimulatedRouter> },
    Record<string, never>,
    Record<string, never>
  >
>;
