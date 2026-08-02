// Review note 4: assumes the foundation extends createAppRouter with a
// charger plugin-router slot, mirroring vehicle/energy.
import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createTapoRouter } from "./server/router.ts";

export type TapoAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    Record<string, never>,
    { tapo: ReturnType<typeof createTapoRouter> }
  >
>;
