import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { sigenergyRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: {},
  energy: { sigenergy: sigenergyRouter },
});

export type SigenergyAppRouter = typeof _typed;
