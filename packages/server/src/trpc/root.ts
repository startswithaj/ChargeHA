import type { AnyRouter } from "@trpc/server";
import { mergeRouters, router } from "./trpc.ts";
import { energyRouter } from "./routers/energy.ts";
import { subscriptionsRouter } from "./routers/subscriptions.ts";
import { statsRouter } from "./routers/stats.ts";
import { vehiclesRouter } from "./routers/vehicles.ts";
import { configRouter } from "./routers/config.ts";
import { healthRouter } from "./routers/health.ts";
import { tariffsRouter } from "./routers/tariffs.ts";
import { schedulesRouter } from "./routers/schedules.ts";
import { logsRouter } from "./routers/logs.ts";
import { notificationsRouter } from "./routers/notifications.ts";
import { wizardRouter } from "./routers/wizard.ts";
import { authRouter } from "./routers/auth.ts";
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
  // Merge core energy procedures with energy plugin sub-routers
  const combinedEnergyRouter = mergeRouters(
    energyRouter,
    router(pluginRouters.energy),
  );

  return router({
    auth: authRouter,
    energy: combinedEnergyRouter,
    subscription: subscriptionsRouter,
    stats: statsRouter,
    vehicle: vehiclesRouter,
    config: configRouter,
    health: healthRouter,
    tariff: tariffsRouter,
    schedule: schedulesRouter,
    log: logsRouter,
    notification: notificationsRouter,
    wizard: wizardRouter,
    ...pluginRouters.vehicle,
  });
}

// Default instance for tests and static type inference
export const appRouter = createAppRouter({ vehicle: {}, energy: {} });

export type AppRouter = typeof appRouter;
