import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createFroniusLocalRouter } from "./server/router.ts";

export type FroniusLocalAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { fronius_local: ReturnType<typeof createFroniusLocalRouter> }
  >
>;
