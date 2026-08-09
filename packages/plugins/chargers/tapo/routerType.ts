import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createTapoRouter } from "./server/router.ts";

export type TapoAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    Record<string, never>,
    { tapo: ReturnType<typeof createTapoRouter> }
  >
>;
