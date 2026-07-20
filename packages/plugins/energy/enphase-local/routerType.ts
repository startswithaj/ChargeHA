import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createEnphaseLocalRouter } from "./server/router.ts";

export type EnphaseLocalAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { enphase_local: ReturnType<typeof createEnphaseLocalRouter> }
  >
>;
