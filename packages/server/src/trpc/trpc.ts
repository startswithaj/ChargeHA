import { initTRPC, TRPCError } from "@trpc/server";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { EnergyPoller } from "../services/EnergyPoller.ts";
import type { VehicleManager } from "../services/VehicleManager.ts";
import type { NotificationService } from "../services/NotificationService.ts";
import type { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import type { TypedEventEmitter } from "../services/TypedEventEmitter.ts";
import type { Logger } from "../lib/Logger.ts";
import type { VehicleService } from "../services/VehicleService.ts";
import type { TariffService } from "../services/TariffService.ts";
import type { StatsService } from "../services/StatsService.ts";
import type { ConfigService } from "../services/ConfigService.ts";
import type { ScheduleService } from "../services/ScheduleService.ts";
import type { WizardService } from "../services/WizardService.ts";
import type { LogService } from "../services/LogService.ts";
import type { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { AuthService } from "../services/AuthService.ts";
import type { OidcService } from "../services/OidcService.ts";
import type { GeocodeService } from "../services/GeocodeService.ts";
import type { HealthService } from "../services/HealthService.ts";
import type { RateLimiter } from "../middleware/rateLimit.ts";
import { AuthError } from "../services/AuthService.ts";
import { GeocodeError } from "../services/GeocodeService.ts";
import { ServiceError } from "../lib/ServiceError.ts";

export interface TrpcContext {
  db: AppDatabase;
  vehicleManager: VehicleManager;
  vehicleService: VehicleService;
  vehiclePlugins: VehiclePluginRegistry;
  energyPlugins: EnergyPluginRegistry;
  tariffService: TariffService;
  statsService: StatsService;
  configService: ConfigService;
  scheduleService: ScheduleService;
  wizardService: WizardService;
  logService: LogService;
  poller: EnergyPoller;
  notificationService: NotificationService;
  energyManager: EnergyAdapterManager;
  eventEmitter: TypedEventEmitter;
  encryptionKey: string | null;
  logger: Logger;
  geocodeService: GeocodeService;
  healthService: HealthService;
  authService: AuthService;
  oidcService: OidcService;
  rateLimiter: RateLimiter;
  responseHeaders?: Headers;
  clientIp?: string;
  isHttps?: boolean;
  sessionId?: string | null;
}

const t = initTRPC.context<TrpcContext>().create({
  sse: {
    // Send pings every 10s to keep the connection alive and detect dead connections
    ping: { enabled: true, intervalMs: 10_000 },
    // Tell the client to reconnect if no data or ping arrives within 30s
    client: { reconnectAfterInactivityMs: 30_000 },
  },
});

/**
 * Middleware that maps domain errors to TRPCErrors so routers don't
 * need try/catch blocks and services stay transport-agnostic.
 *
 * In tRPC v11, next() returns a result object instead of throwing.
 * When result.ok is false, the original domain error is in
 * result.error.cause — we inspect it and throw the mapped TRPCError.
 */
const errorMiddleware = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;

    // Domain errors → TRPCError with matching code.
    // ServiceError is the base class for transport-agnostic service errors.
    // AuthError and GeocodeError predate ServiceError and have their own
    // code types, so they're checked separately.
    if (cause instanceof ServiceError) {
      throw new TRPCError({
        code: cause.code,
        message: cause.message,
      });
    }

    // AuthError → TRPCError with matching code
    if (cause instanceof AuthError) {
      throw new TRPCError({
        code: cause.code,
        message: cause.message,
      });
    }

    // GeocodeError → TRPCError with matching code
    if (cause instanceof GeocodeError) {
      throw new TRPCError({
        code: cause.code,
        message: cause.message,
      });
    }

    // AuthService.login() throws plain Error("Invalid credentials")
    if (cause instanceof Error && cause.message === "Invalid credentials") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "invalid_credentials",
      });
    }
  }
  return result;
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure.use(errorMiddleware);
export const createCallerFactory = t.createCallerFactory;
