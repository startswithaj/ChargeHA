import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { NotificationService } from "../services/NotificationService.ts";
import { TelegramProvider } from "../services/notification-providers/TelegramProvider.ts";
import { VehicleFetchLogger } from "../services/VehicleFetchLogger.ts";
import { VehicleManager } from "../services/VehicleManager.ts";
import { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import { EnergyPoller } from "../services/EnergyPoller.ts";
import { VehicleService } from "../services/VehicleService.ts";
import { TariffService } from "../services/TariffService.ts";
import { StatsService } from "../services/StatsService.ts";
import { OidcService } from "../services/OidcService.ts";
import { RateLimiter } from "../middleware/rateLimit.ts";
import { AuthService } from "../services/AuthService.ts";
import { ScheduleService } from "../services/ScheduleService.ts";
import { DataRecorder } from "../services/DataRecorder.ts";
import { NotificationListener } from "../services/NotificationListener.ts";
import { ChargeController } from "../services/ChargeController.ts";
import { Overseer } from "../services/Overseer.ts";
import {
  createAuthMiddleware,
  hstsMiddleware,
  isHttps,
} from "../middleware/auth.ts";
import { createOidcRoutes } from "../routes/oidcAuth.ts";
import { createAppRouter } from "../trpc/root.ts";
import type { TrpcContext } from "../trpc/trpc.ts";

  const tariffService = new TariffService(
    db,
    new Logger("TariffService", logLevel),
  );
  const statsService = new StatsService(db);
  const oidcService = new OidcService(
    db,
    encryptionKey,
    new Logger("OIDC", logLevel),
  );
  const rateLimiter = new RateLimiter();
  const authService = new AuthService(
    db,
    encryptionKey,
    new Logger("Auth", logLevel),
    oidcService,
    configService,
    rateLimiter,
  );
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
function registerNotificationListeners(
  { eventEmitter, notificationService, db, scheduleService, logLevel }: {
    eventEmitter: TypedEventEmitter;
    notificationService: NotificationService;
    db: AppDatabase;
    scheduleService: ScheduleService;
    logLevel: "debug" | "info" | "warn" | "error";
  },
) {
  new NotificationListener(
    eventEmitter,
    notificationService,
    db,
    scheduleService,
    new Logger("Notifications", logLevel),
  );
}
  const notificationService = new NotificationService(
    db,
    [new TelegramProvider(db)],
    new Logger("Notifications", logLevel),
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
  registerNotificationListeners({
    eventEmitter,
    notificationService,
    db,
    scheduleService,
    logLevel,
  });
  new ChargeController(
    vehicleManager,
    poller,
    db,
    configService,
    eventEmitter,
    new Logger("ChargeController", logLevel),
  );
  new Overseer(db, eventEmitter, new Logger("Overseer", logLevel));
function buildHttpApp(
) {
  const appRouter = createAppRouter({
  });
  const app = new Hono();
  app.use(secureHeaders({ strictTransportSecurity: false }));
  app.use(hstsMiddleware());
  const authLogger = new Logger("Auth", logLevel);
  app.use(
    createAuthMiddleware({
      authService: services.authService,
      configService: services.configService,
      logger: authLogger,
    }),
  );
  app.route(
    "/auth/oidc",
    createOidcRoutes({
      authService: services.authService,
      oidcService: services.oidcService,
      logger: authLogger,
    }),
  );
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
