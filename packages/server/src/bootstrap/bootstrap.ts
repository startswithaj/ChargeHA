import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/deno";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { AppDatabase } from "../db/AppDatabase.ts";
import {
  resolveEncryptionKeyFromEnv,
  warnIfEncryptedRowsButNoKey,
} from "../lib/EncryptionKey.ts";
import { isValidLogLevel, Logger } from "../lib/Logger.ts";
import type { LogLevel } from "../lib/Logger.ts";

import { TypedEventEmitter } from "../services/TypedEventEmitter.ts";
import { NotificationService } from "../services/NotificationService.ts";
import { TelegramProvider } from "../services/notification-providers/TelegramProvider.ts";
import { VehicleFetchLogger } from "../services/VehicleFetchLogger.ts";
import { VehicleManager } from "../services/VehicleManager.ts";
import { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import { EnergyPoller } from "../services/EnergyPoller.ts";
import { VehicleService } from "../services/VehicleService.ts";
import { TariffService } from "../services/TariffService.ts";
import { StatsService } from "../services/StatsService.ts";
import { ConfigService } from "../services/ConfigService.ts";
import { GeocodeService } from "../services/GeocodeService.ts";
import { OidcService } from "../services/OidcService.ts";
import { RateLimiter } from "../middleware/rateLimit.ts";
import { AuthService } from "../services/AuthService.ts";
import { ScheduleService } from "../services/ScheduleService.ts";
import { TunnelManager } from "../services/TunnelManager.ts";
import { WizardService } from "../services/WizardService.ts";
import { LogService } from "../services/LogService.ts";
import { DataRecorder } from "../services/DataRecorder.ts";
import { NotificationListener } from "../services/NotificationListener.ts";
import { ChargeController } from "../services/ChargeController.ts";
import { Overseer } from "../services/Overseer.ts";
import { HealthService } from "../services/HealthService.ts";

import { VehiclePluginRegistry } from "./VehiclePluginRegistry.ts";
import { EnergyPluginRegistry } from "./EnergyPluginRegistry.ts";
import { registerPlugins } from "@chargeha/plugins/registerPlugins";

import {
  createAuthMiddleware,
  hstsMiddleware,
  isHttps,
} from "../middleware/auth.ts";
import { createOidcRoutes } from "../routes/oidcAuth.ts";
import { createAppRouter } from "../trpc/root.ts";
import type { TrpcContext } from "../trpc/trpc.ts";

const DEFAULT_DB_PATH = `${Deno.cwd()}/data/chargeha.db`;

function parseLogLevel(raw: string | undefined): LogLevel {
  if (!raw) return "info";
  if (isValidLogLevel(raw)) return raw.toLowerCase() as LogLevel;
  console.error(
    `[Config] Invalid LOG_LEVEL="${raw}" — valid values: debug, info, warn, error. Falling back to "info".`,
  );
  return "info";
}

/**
 * Construct the entire app: infrastructure, services, plugins, HTTP router.
 * Returns a `shutdown` function that stops the server, shuts down plugins,
 * closes the tunnel, and closes the DB.
 */
function buildAuxServices(
  {
    db,
    energyManager,
    encryptionKey,
    logLevel,
    port,
    vehicleRegistry,
    vehicleManager,
    eventEmitter,
  }: {
    db: AppDatabase;
    energyManager: EnergyAdapterManager;
    encryptionKey: string | null;
    logLevel: "debug" | "info" | "warn" | "error";
    port: number;
    vehicleRegistry: VehiclePluginRegistry;
    vehicleManager: VehicleManager;
    eventEmitter: TypedEventEmitter;
  },
) {
  const tariffService = new TariffService(
    db,
    new Logger("TariffService", logLevel),
  );
  const statsService = new StatsService(db);
  const configService = new ConfigService(
    db,
    energyManager,
    encryptionKey,
    new Logger("ConfigService", logLevel),
  );
  const geocodeService = new GeocodeService(new Logger("Geocode", logLevel));
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
  const tunnelManager = new TunnelManager(
    new Logger("Tunnel", logLevel),
    port,
    () => vehicleRegistry.getAll().flatMap((p) => p.getTunnelRoutes()),
    4040,
    Deno.env.get("CLOUDFLARED_PATH") ?? "cloudflared",
  );
  const wizardService = new WizardService(
    db,
    encryptionKey,
    new Logger("WizardService", logLevel),
    tunnelManager,
    vehicleManager,
    authService,
    oidcService,
  );
  const logService = new LogService(db);

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

  return {
    tariffService,
    statsService,
    configService,
    geocodeService,
    oidcService,
    rateLimiter,
    authService,
    scheduleService,
    tunnelManager,
    wizardService,
    logService,
    poller,
  };
}

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

function buildServices(
  {
    db,
    eventEmitter,
    encryptionKey,
    vehicleRegistry,
    energyRegistry,
    logLevel,
    port,
  }: {
    db: AppDatabase;
    eventEmitter: TypedEventEmitter;
    encryptionKey: string | null;
    vehicleRegistry: VehiclePluginRegistry;
    energyRegistry: EnergyPluginRegistry;
    logLevel: "debug" | "info" | "warn" | "error";
    port: number;
  },
) {
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
  const auxServices = buildAuxServices({
    db,
    energyManager,
    encryptionKey,
    logLevel,
    port,
    vehicleRegistry,
    vehicleManager,
    eventEmitter,
  });
  const {
    tariffService,
    statsService,
    configService,
    geocodeService,
    oidcService,
    rateLimiter,
    authService,
    scheduleService,
    tunnelManager,
    wizardService,
    logService,
    poller,
  } = auxServices;

  registerNotificationListeners({
    eventEmitter,
    notificationService,
    db,
    scheduleService,
    logLevel,
  });

  const healthService = new HealthService(
    vehicleRegistry,
    energyRegistry,
    encryptionKey,
  );

  new ChargeController(
    vehicleManager,
    poller,
    db,
    configService,
    eventEmitter,
    new Logger("ChargeController", logLevel),
  );
  new Overseer(db, eventEmitter, new Logger("Overseer", logLevel));

  return {
    notificationService,
    vehicleManager,
    energyManager,
    vehicleService,
    tariffService,
    statsService,
    configService,
    geocodeService,
    oidcService,
    rateLimiter,
    authService,
    scheduleService,
    tunnelManager,
    wizardService,
    logService,
    poller,
    healthService,
  };
}

function buildHttpApp(
  {
    db,
    services,
    vehicleRegistry,
    energyRegistry,
    eventEmitter,
    encryptionKey,
    logLevel,
  }: {
    db: AppDatabase;
    services: ReturnType<typeof buildServices>;
    vehicleRegistry: VehiclePluginRegistry;
    energyRegistry: EnergyPluginRegistry;
    eventEmitter: TypedEventEmitter;
    encryptionKey: string | null;
    logLevel: "debug" | "info" | "warn" | "error";
  },
) {
  const appRouter = createAppRouter({
    vehicle: vehicleRegistry.getPluginRouters(),
    energy: energyRegistry.getPluginRouters(),
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

  vehicleRegistry.getAll().forEach((plugin) => {
    const httpRoutes = plugin.getHttpRoutes();
    if (httpRoutes) app.route(`/api/vehicle/${plugin.id}`, httpRoutes);
  });

  const trpcLogger = new Logger("tRPC", logLevel);
  setupTrpcEndpoint(app, appRouter, {
    db,
    vehicleManager: services.vehicleManager,
    vehicleService: services.vehicleService,
    vehicleRegistry,
    energyRegistry,
    tariffService: services.tariffService,
    statsService: services.statsService,
    configService: services.configService,
    geocodeService: services.geocodeService,
    healthService: services.healthService,
    scheduleService: services.scheduleService,
    wizardService: services.wizardService,
    logService: services.logService,
    poller: services.poller,
    notificationService: services.notificationService,
    energyManager: services.energyManager,
    eventEmitter,
    encryptionKey,
    authService: services.authService,
    oidcService: services.oidcService,
    rateLimiter: services.rateLimiter,
    trpcLogger,
  });

  app.use("/*", serveStatic({ root: "./packages/server/dist" }));
  app.use(
    "/*",
    serveStatic({ root: "./packages/server/dist", path: "index.html" }),
  );

  return app;
}

function setupTrpcEndpoint(
  app: Hono,
  appRouter: ReturnType<typeof createAppRouter>,
  ctx: {
    db: AppDatabase;
    vehicleManager: VehicleManager;
    vehicleService: VehicleService;
    vehicleRegistry: VehiclePluginRegistry;
    energyRegistry: EnergyPluginRegistry;
    tariffService: TariffService;
    statsService: StatsService;
    configService: ConfigService;
    geocodeService: GeocodeService;
    healthService: HealthService;
    scheduleService: ScheduleService;
    wizardService: WizardService;
    logService: LogService;
    poller: EnergyPoller;
    notificationService: NotificationService;
    energyManager: EnergyAdapterManager;
    eventEmitter: TypedEventEmitter;
    encryptionKey: string | null;
    authService: AuthService;
    oidcService: OidcService;
    rateLimiter: RateLimiter;
    trpcLogger: Logger;
  },
) {
  app.all("/trpc/*", async (c) => {
    const responseHeaders = new Headers();
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): TrpcContext => ({
        db: ctx.db,
        vehicleManager: ctx.vehicleManager,
        vehicleService: ctx.vehicleService,
        vehiclePlugins: ctx.vehicleRegistry,
        energyPlugins: ctx.energyRegistry,
        tariffService: ctx.tariffService,
        statsService: ctx.statsService,
        configService: ctx.configService,
        geocodeService: ctx.geocodeService,
        healthService: ctx.healthService,
        scheduleService: ctx.scheduleService,
        wizardService: ctx.wizardService,
        logService: ctx.logService,
        poller: ctx.poller,
        notificationService: ctx.notificationService,
        energyManager: ctx.energyManager,
        eventEmitter: ctx.eventEmitter,
        encryptionKey: ctx.encryptionKey,
        logger: ctx.trpcLogger,
        authService: ctx.authService,
        oidcService: ctx.oidcService,
        rateLimiter: ctx.rateLimiter,
        responseHeaders,
        clientIp: extractClientIp(c.req.raw),
        isHttps: isHttps(c.req.raw),
        sessionId: parseCookieValue(c.req.header("Cookie"), "session_id"),
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
  // ── Infrastructure ────────────────────────────────────────────────────
  const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);
  const dbPath = Deno.env.get("DB_PATH") ?? DEFAULT_DB_PATH;
  const reset_auth = Deno.env.get("RESET_AUTH") === "true";
  const logLevel = parseLogLevel(Deno.env.get("LOG_LEVEL"));
  const serverLogger = new Logger("Server", logLevel);
  serverLogger.info(`LOG_LEVEL=${logLevel}`);

  if (reset_auth) {
    serverLogger.warn(
      "[Auth] WARN: RESET_AUTH is active — authentication is disabled",
    );
  }

  const dataDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  try {
    await Deno.mkdir(dataDir, { recursive: true });
  } catch (error) {
    serverLogger.debug(`Data directory creation skipped: ${error}`);
  }

  const encryptionKey = resolveEncryptionKeyFromEnv();

  const eventEmitter = new TypedEventEmitter();
  const dbLogger = new Logger("DB", logLevel);
  const db = new AppDatabase(dbPath, encryptionKey, eventEmitter, dbLogger);
  await db.init();
  dbLogger.info(`SQLite initialized at ${dbPath}`);

  await warnIfEncryptedRowsButNoKey(db, encryptionKey);

  // ── Empty plugin registries (populated by registerPlugins below) ──────
  const vehicleRegistry = new VehiclePluginRegistry();
  const energyRegistry = new EnergyPluginRegistry();

  const services = buildServices({
    db,
    eventEmitter,
    encryptionKey,
    vehicleRegistry,
    energyRegistry,
    logLevel,
    port,
  });

  // Plugins self-initialize in their constructors.
  registerPlugins(
    {
      db,
      vehicleManager: services.vehicleManager,
      energyManager: services.energyManager,
      tunnel: {
        getUrl: () => services.tunnelManager.tunnelUrl,
        start: async () => ({ url: await services.tunnelManager.start() }),
        stop: () => services.tunnelManager.stop(),
      },
      geocode: (query) => services.geocodeService.geocodeAddress(query),
      encryptionConfigured: () => encryptionKey !== null,
    },
    vehicleRegistry,
    energyRegistry,
  );

  const app = buildHttpApp({
    db,
    services,
    vehicleRegistry,
    energyRegistry,
    eventEmitter,
    encryptionKey,
    logLevel,
  });

  const server = Deno.serve({ port }, app.fetch);
  serverLogger.info(
    `ChargeHA running on http://localhost:${port} (log level: ${logLevel})`,
  );

  return {
    shutdown: async () => {
      // Stop the HTTP server first so in-flight requests don't hit a closed DB.
      await server.shutdown();
      // Tesla plugin's shutdown() reaps the tesla-http-proxy subprocess
      await vehicleRegistry.shutdownAll();
      await energyRegistry.shutdownAll();

      await services.tunnelManager.stop();
      db.close();
    },
  };
}

function parseCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  const match = cookies.find((cookie) => {
    const [key] = cookie.trim().split("=");
    return key === name;
  });
  if (!match) return null;
  const [, ...rest] = match.trim().split("=");
  return rest.join("=");
}

function extractClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return "unknown";
}
