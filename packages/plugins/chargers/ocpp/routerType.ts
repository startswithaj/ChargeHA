import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createOcppRouter } from "./server/router.ts";

export type OcppAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    Record<string, never>,
    { ocpp: ReturnType<typeof createOcppRouter> }
  >
>;
