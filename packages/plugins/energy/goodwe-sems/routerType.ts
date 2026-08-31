import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createGoodweSemsRouter } from "./server/router.ts";

export type GoodweSemsAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { goodwe_sems: ReturnType<typeof createGoodweSemsRouter> },
    Record<string, never>
  >
>;
