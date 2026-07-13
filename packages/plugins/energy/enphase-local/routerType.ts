import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { enphaseLocalRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: {},
  energy: { enphase_local: enphaseLocalRouter },
});

export type EnphaseLocalAppRouter = typeof _typed;
