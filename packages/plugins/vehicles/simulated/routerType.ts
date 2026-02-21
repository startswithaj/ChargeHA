import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { simulatedRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: { simulated: simulatedRouter },
  energy: {},
});

export type SimulatedAppRouter = typeof _typed;
