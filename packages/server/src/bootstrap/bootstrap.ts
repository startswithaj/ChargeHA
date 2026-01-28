import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { VehicleFetchLogger } from "../services/VehicleFetchLogger.ts";
import { VehicleManager } from "../services/VehicleManager.ts";
import { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import { EnergyPoller } from "../services/EnergyPoller.ts";
import { VehicleService } from "../services/VehicleService.ts";
import { StatsService } from "../services/StatsService.ts";
import { ScheduleService } from "../services/ScheduleService.ts";
import { DataRecorder } from "../services/DataRecorder.ts";
import { ChargeController } from "../services/ChargeController.ts";
import { createAppRouter } from "../trpc/root.ts";
import type { TrpcContext } from "../trpc/trpc.ts";

  const statsService = new StatsService(db);
  const scheduleService = new ScheduleService(
    db,
    new Logger("ScheduleService", logLevel),
  );
  new DataRecorder(
    db,
    vehicleManager,
    tariffService,
    eventEmitter,
    new Logger("DataRecorder", logLevel),
  );
  const poller = new EnergyPoller(
    energyManager,
    eventEmitter,
    db,
    new Logger("EnergyPoller", logLevel),
  );
  new VehicleFetchLogger(db, eventEmitter, new Logger("FetchLog", logLevel));
  const vehicleManager = new VehicleManager(
    db,
    eventEmitter,
    new Logger("VehicleManager", logLevel),
    vehicleRegistry,
  );
  const energyManager = new EnergyAdapterManager(
    db,
    energyRegistry,
    new Logger("EnergyAdapter", logLevel),
  );
  const vehicleService = new VehicleService(
    db,
    vehicleManager,
    vehicleRegistry,
    eventEmitter,
    new Logger("VehicleService", logLevel),
  );
  new ChargeController(
    vehicleManager,
    poller,
    db,
    configService,
    eventEmitter,
    new Logger("ChargeController", logLevel),
  );
function buildHttpApp(
) {
  const appRouter = createAppRouter({
  });
  const app = new Hono();
  app.use(secureHeaders({ strictTransportSecurity: false }));
  setupTrpcEndpoint(app, appRouter, {
  });
  return app;
}

function setupTrpcEndpoint(
  app: Hono,
  appRouter: ReturnType<typeof createAppRouter>,
  ctx: {
  },
) {
  app.all("/trpc/*", async (c) => {
    const responseHeaders = new Headers();
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): TrpcContext => ({
      }),
    });
    [...responseHeaders.entries()].forEach(([key, value]) => {
      response.headers.append(key, value);
    });
    return response;
  });
}

export async function bootstrap(): Promise<
  { shutdown: () => Promise<void> }
> {
  const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);
  const app = buildHttpApp({
  });
  const server = Deno.serve({ port }, app.fetch);
  return {
    shutdown: async () => {
      await server.shutdown();
    },
  };
}
