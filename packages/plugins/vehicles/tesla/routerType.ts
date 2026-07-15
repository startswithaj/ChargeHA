import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createTeslaRouter } from "./server/router.ts";

export type TeslaAppRouter = ReturnType<
  typeof createAppRouter<
    { tesla: ReturnType<typeof createTeslaRouter> },
    Record<string, never>
  >
>;
