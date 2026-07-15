import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createFroniusCloudRouter } from "./server/router.ts";

export type FroniusCloudAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { fronius_cloud: ReturnType<typeof createFroniusCloudRouter> }
  >
>;
