import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createPowerwall2LocalRouter } from "./server/router.ts";

export type Powerwall2LocalAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { powerwall2_local: ReturnType<typeof createPowerwall2LocalRouter> },
    Record<string, never>
  >
>;
