import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { sigenergyLocalRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: {},
  energy: { sigenergy_local: sigenergyLocalRouter },
});

export type SigenergyLocalAppRouter = typeof _typed;
