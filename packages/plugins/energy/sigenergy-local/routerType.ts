import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createSigenergyLocalRouter } from "./server/router.ts";

export type SigenergyLocalAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { sigenergy_local: ReturnType<typeof createSigenergyLocalRouter> }
  >
>;
