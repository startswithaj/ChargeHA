import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { simulatedEnergyRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: {},
  energy: { simulated_energy: simulatedEnergyRouter },
});

export type SimulatedEnergyAppRouter = typeof _typed;
