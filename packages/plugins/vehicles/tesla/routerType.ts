import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { teslaRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: { tesla: teslaRouter },
  energy: {},
});

export type TeslaAppRouter = typeof _typed;
