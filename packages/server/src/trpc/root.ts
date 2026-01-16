import type { AnyRouter } from "@trpc/server";
import { mergeRouters, router } from "./trpc.ts";
/** Plugin router records collected from registries at startup. */
export interface PluginRouters<
  TVehicle extends Record<string, AnyRouter> = Record<string, AnyRouter>,
  TEnergy extends Record<string, AnyRouter> = Record<string, AnyRouter>,
> {
  vehicle: TVehicle;
  energy: TEnergy;
}

/** Builds the app router with dynamically-mounted plugin routers. */
export function createAppRouter<
  TVehicle extends Record<string, AnyRouter>,
  TEnergy extends Record<string, AnyRouter>,
>(pluginRouters: PluginRouters<TVehicle, TEnergy>) {
  return router({
  });
}

// Default instance for tests and static type inference
export const appRouter = createAppRouter({ vehicle: {}, energy: {} });

export type AppRouter = typeof appRouter;
