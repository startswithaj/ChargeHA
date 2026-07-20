import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { HealthService } from "../../services/HealthService.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import type { VehiclePlugin } from "@chargeha/plugins/types";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Health tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  let db: AppDatabase;

  const makePlugin = (
    overrides: Partial<VehiclePlugin> = {},
  ): VehiclePlugin => ({
    id: "test",
    displayName: "Test",
    configDef: {},
    secretKeys: [],
    settingsComponentKey: null,
    createMiddleware: () =>
      Promise.resolve(
        throwingMock<ReturnType<VehiclePlugin["createMiddleware"]>>(
          "VehicleMiddleware",
        ),
      ),
    shutdown: () => Promise.resolve(),
    getRouter: () => null,
    getHttpRoutes: () => null,
    getHealthChecks: () => [],
    getCommandStatus: () =>
      Promise.resolve({ commandsDisabled: false, reason: null }),
    getTunnelRoutes: () => [],
    ...overrides,
  });

  const setupCaller = async (
    encryptionKey: string | null,
    plugin?: VehiclePlugin,
  ) => {
    db = new AppDatabase(":memory:");
    await db.init();
    const vehiclePlugins = new VehiclePluginRegistry();
    if (plugin) vehiclePlugins.register(plugin);
    const healthService = new HealthService(
      vehiclePlugins,
      new EnergyPluginRegistry(),
      encryptionKey,
    );
    return createCaller(throwingMock<TrpcContext>("TrpcContext", {
      healthService,
    }));
  };

  afterEach(() => {
    db.close();
  });

  describe("health.encryption", () => {
    ([
      ["configured: false when no encryption key", null, false],
      ["configured: true when encryption key is set", "some-key", true],
    ] as const).forEach(([name, key, expected]) => {
      it(`returns ${name}`, async () => {
        const caller = await setupCaller(key);
        const data = await caller.health.encryption();
        expect(data.configured).toBe(expected);
      });
    });
  });

  describe("health.pluginWarnings", () => {
    it("returns empty array when all health checks pass", async () => {
      const plugin = makePlugin({
        getHealthChecks: () => [{
          name: "test-check",
          warningTitle: "Test Warning",
          warningMessage: "Something is wrong",
          run: () => Promise.resolve({ status: "ok" as const }),
        }],
      });
      const caller = await setupCaller(null, plugin);

      const data = await caller.health.pluginWarnings();
      expect(data).toEqual([]);
    });

    it("returns warning when a health check fails", async () => {
      const plugin = makePlugin({
        getHealthChecks: () => [{
          name: "test-check",
          warningTitle: "Proxy Down",
          warningMessage: "Cannot reach proxy",
          run: () =>
            Promise.resolve({
              status: "error" as const,
              message: "not reachable",
            }),
        }],
      });
      const caller = await setupCaller(null, plugin);

      const data = await caller.health.pluginWarnings();
      expect(data).toEqual([
        { title: "Proxy Down", message: "Cannot reach proxy" },
      ]);
    });
  });
});
