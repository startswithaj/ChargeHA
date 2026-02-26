import { createTRPCReact } from "@trpc/react-query";
import type { AnyRouter, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/src/trpc/root.ts";

export const trpc = createTRPCReact<AppRouter>();
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Widen the base trpc instance to include additional plugin router types.
 * Returns the same runtime object (same React context/Provider) but with
 * a wider type that includes plugin routes in _def.record.
 */
export function widenTrpc<TRouter extends AnyRouter>() {
  return trpc as unknown as ReturnType<typeof createTRPCReact<TRouter>>;
}
