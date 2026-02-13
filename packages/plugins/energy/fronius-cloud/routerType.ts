import { createAppRouter } from "../../../server/src/trpc/root.ts";
import { froniusCloudRouter } from "./server/router.ts";

const _typed = createAppRouter({
  vehicle: {},
  energy: { fronius_cloud: froniusCloudRouter },
});

export type FroniusCloudAppRouter = typeof _typed;
