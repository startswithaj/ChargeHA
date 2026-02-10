import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { froniusLocalRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: {},
  energy: { fronius_local: froniusLocalRouter },
});

export type FroniusLocalAppRouter = typeof _typed;
