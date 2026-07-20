import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import type { EnergyPlugin } from "@chargeha/plugins/types";
import { Logger } from "../lib/Logger.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";
import { MockEnergyAdapter } from "../test-helpers/MockEnergyAdapter.ts";

describe("EnergyAdapterManager", () => {
  const testLogger = new Logger("EnergyAdapterManager", "error");

  const BASE_REALTIME: EnergyData = {
    solarProductionW: 5000,
    gridPowerW: -2000,
    homeConsumptionW: 3000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const DEVICE_INFO: DeviceInfo = {
    id: "test",
    name: "Test Adapter",
    manufacturer: "Test",
    model: "T1",
  };

  function makeMockPlugin(
    id: string,
    createAdapter: () => Promise<EnergySourceAdapter>,
  ): EnergyPlugin {
    return {
      id,
      displayName: id,
      vendor: "Test",
      settingsComponentKey: `${id}-settings`,
      configDef: {},
      secretKeys: [],
      createAdapter,
      shutdown: () => Promise.resolve(),
      getRouter: () => null,
      getHealthChecks: () => [],
    };
  }

  /**
   * Create an EnergyAdapterManager wired to a mock plugin that produces a
   * MockAdapter. Awaits initialization so the adapter is in place before the
   * caller exercises it.
   */
  async function createManagerWithMock(): Promise<{
    manager: EnergyAdapterManager;
    inner: MockEnergyAdapter;
  }> {
    const inner = new MockEnergyAdapter(
      BASE_REALTIME,
      DEVICE_INFO,
    );
    const plugin = makeMockPlugin("test-mock", () => Promise.resolve(inner));
    const registry = new EnergyPluginRegistry();
    registry.register(plugin);
    const mockDb = throwingMock<AppDatabase>("AppDatabase", {
      getConfig: () => Promise.resolve("test-mock"),
    });
    const manager = new EnergyAdapterManager(
      mockDb,
      registry,
      testLogger,
    );
    // Wait for initialize() to settle so this.adapter is set to `inner`.
    // deno-lint-ignore no-explicit-any
    await (manager as any).initializationPromise;
    return { manager, inner };
  }

  let manager: EnergyAdapterManager;
  let inner: MockEnergyAdapter;

  beforeEach(async () => {
    ({ manager, inner } = await createManagerWithMock());
  });

  describe("passthrough delegation", () => {
    it("forwards pollIntervalSeconds from inner adapter", () => {
      expect(manager.pollIntervalSeconds()).toBe(5);
    });

    it("delegates connect to inner adapter", async () => {
      await manager.connect();
      expect(inner.connectCalled).toBe(true);
    });

    it("delegates disconnect to inner adapter", async () => {
      await manager.disconnect();
      expect(inner.disconnectCalled).toBe(true);
    });

    it("delegates getDeviceInfo to inner adapter", async () => {
      const info = await manager.getDeviceInfo();
      expect(info).toEqual(DEVICE_INFO);
    });
  });

  describe("getRealtimeData with no simulated load", () => {
    it("returns unmodified data when simulated load is 0", async () => {
      const data = await manager.getRealtimeData();
      expect(data).toEqual(BASE_REALTIME);
    });
  });

  describe("setSimulatedLoad", () => {
    it("adds load to homeConsumption and gridPower", async () => {
      manager.setSimulatedLoad(2000);
      const data = await manager.getRealtimeData();
      expect(data.homeConsumptionW).toBe(5000);
      expect(data.gridPowerW).toBe(0);
      expect(data.solarProductionW).toBe(5000);
    });

    it("clamps negative watts to 0", async () => {
      manager.setSimulatedLoad(-500);
      const data = await manager.getRealtimeData();
      expect(data.homeConsumptionW).toBe(3000);
      expect(data.gridPowerW).toBe(-2000);
    });

    it("can reset load to 0", async () => {
      manager.setSimulatedLoad(2000);
      manager.setSimulatedLoad(0);
      const data = await manager.getRealtimeData();
      expect(data).toEqual(BASE_REALTIME);
    });
  });

  describe("getPluginSummaries", () => {
    it("returns plugin summaries with configured status", () => {
      const mockPlugin = makeMockPlugin(
        "fronius-local",
        () =>
          Promise.resolve(
            new MockEnergyAdapter(BASE_REALTIME, DEVICE_INFO),
          ),
      );
      const registry = new EnergyPluginRegistry();
      registry.register(mockPlugin);
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve(null),
      });
      const mgr = new EnergyAdapterManager(
        mockDb,
        registry,
        testLogger,
      );
      const summaries = mgr.getPluginSummaries();
      expect(summaries).toEqual([{
        id: "fronius-local",
        displayName: "fronius-local",
        vendor: "Test",
        settingsComponentKey: "fronius-local-settings",
        configured: false,
      }]);
    });
  });

  describe("getRecentReadings", () => {
    it("returns readings from db with default limit", async () => {
      const mockReadings = [
        { ...BASE_REALTIME, timestamp: "2024-01-01T00:00:00Z" },
      ];
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve(null),
        getRecentReadings: (limit: number) => {
          expect(limit).toBe(60);
          return Promise.resolve(mockReadings);
        },
      });
      const emptyRegistry = new EnergyPluginRegistry();
      const mgr = new EnergyAdapterManager(
        mockDb,
        emptyRegistry,
        testLogger,
      );
      const result = await mgr.getRecentReadings();
      expect(result.readings).toEqual(mockReadings);
    });

    it("passes custom limit to db", async () => {
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve(null),
        getRecentReadings: (limit: number) => {
          expect(limit).toBe(10);
          return Promise.resolve([]);
        },
      });
      const emptyRegistry = new EnergyPluginRegistry();
      const mgr = new EnergyAdapterManager(
        mockDb,
        emptyRegistry,
        testLogger,
      );
      const result = await mgr.getRecentReadings(10);
      expect(result.readings).toEqual([]);
    });
  });

  describe("reconfigure", () => {
    it("keeps the configured type relevant after createAdapter fails so a later config save retries", async () => {
      let host = "";
      const mockPlugin = makeMockPlugin("late-config", () => {
        if (!host) return Promise.reject(new Error("host not configured"));
        return Promise.resolve(
          new MockEnergyAdapter(BASE_REALTIME, DEVICE_INFO),
        );
      });
      const registry = new EnergyPluginRegistry();
      registry.register(mockPlugin);
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("late-config"),
      });
      const mgr = new EnergyAdapterManager(mockDb, registry, testLogger);
      // deno-lint-ignore no-explicit-any
      await (mgr as any).initializationPromise;

      // Build failed but the keys must stay relevant, or a later host save never rebuilds.
      expect(mgr.isRelevantConfigKey("late-config.host")).toBe(true);

      host = "192.0.2.10"; // the wizard's setup step saves the host
      await mgr.reconfigure();
      const data = await mgr.getRealtimeData();
      expect(data.solarProductionW).toBe(5000); // real adapter, not the null one
    });

    it("catches connection failure on new adapter and continues", async () => {
      const connectError = new Error("connection refused");
      const failAdapter: EnergySourceAdapter = {
        pollIntervalSeconds: () => 10,
        connect: () => Promise.reject(connectError),
        disconnect: () => Promise.resolve(),
        getRealtimeData: () => Promise.resolve({ ...BASE_REALTIME }),
        getDeviceInfo: () => Promise.resolve({ ...DEVICE_INFO }),
      };
      const mockPlugin = makeMockPlugin(
        "fail-connect",
        () => Promise.resolve(failAdapter),
      );
      const registry = new EnergyPluginRegistry();
      registry.register(mockPlugin);
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("fail-connect"),
      });
      const mgr = new EnergyAdapterManager(
        mockDb,
        registry,
        testLogger,
      );
      await mgr.reconfigure();
      expect(mgr.pollIntervalSeconds()).toBe(10);
    });

    it("rebuilds the adapter from current config", async () => {
      const mockAdapter = new MockEnergyAdapter(
        BASE_REALTIME,
        DEVICE_INFO,
      );
      const mockPlugin = makeMockPlugin(
        "test-energy",
        () => Promise.resolve(mockAdapter),
      );
      const registry = new EnergyPluginRegistry();
      registry.register(mockPlugin);
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("test-energy"),
      });
      const mgr = new EnergyAdapterManager(
        mockDb,
        registry,
        testLogger,
      );
      await mgr.reconfigure();
      expect(mgr.pollIntervalSeconds()).toBe(5);
      expect(mockAdapter.connectCalled).toBe(true);
    });
  });

  describe("buildAdapter (via reconfigure)", () => {
    it("returns NullEnergyAdapter when config is 'none'", async () => {
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("none"),
      });
      const emptyRegistry = new EnergyPluginRegistry();
      const mgr = new EnergyAdapterManager(
        mockDb,
        emptyRegistry,
        testLogger,
      );
      await mgr.reconfigure();
      expect(mgr.pollIntervalSeconds()).toBe(30);
    });

    it("falls back to NullEnergyAdapter when plugin is unregistered", async () => {
      const registry = new EnergyPluginRegistry();
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("not-registered"),
      });
      const mgr = new EnergyAdapterManager(
        mockDb,
        registry,
        testLogger,
      );
      await mgr.reconfigure();
      expect(mgr.pollIntervalSeconds()).toBe(30);
    });

    it("falls back to NullEnergyAdapter when createAdapter throws", async () => {
      const mockPlugin = makeMockPlugin(
        "fail-create",
        () => Promise.reject(new Error("create failed")),
      );
      const registry = new EnergyPluginRegistry();
      registry.register(mockPlugin);
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("fail-create"),
      });
      const mgr = new EnergyAdapterManager(
        mockDb,
        registry,
        testLogger,
      );
      await mgr.reconfigure();
      expect(mgr.pollIntervalSeconds()).toBe(30);
    });
  });

  describe("isRelevantConfigKey", () => {
    it("returns true for energy_adapter_type", async () => {
      const mockPlugin = makeMockPlugin(
        "test-energy",
        () =>
          Promise.resolve(
            new MockEnergyAdapter(BASE_REALTIME, DEVICE_INFO),
          ),
      );
      const registry = new EnergyPluginRegistry();
      registry.register(mockPlugin);
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("test-energy"),
      });
      const mgr = new EnergyAdapterManager(
        mockDb,
        registry,
        testLogger,
      );
      await mgr.reconfigure();
      expect(mgr.isRelevantConfigKey("energy_adapter_type")).toBe(true);
    });

    it("returns true for keys prefixed with active adapter type", async () => {
      const mockPlugin = makeMockPlugin(
        "test-energy",
        () =>
          Promise.resolve(
            new MockEnergyAdapter(BASE_REALTIME, DEVICE_INFO),
          ),
      );
      const registry = new EnergyPluginRegistry();
      registry.register(mockPlugin);
      const mockDb = throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("test-energy"),
      });
      const mgr = new EnergyAdapterManager(
        mockDb,
        registry,
        testLogger,
      );
      await mgr.reconfigure();
      expect(mgr.isRelevantConfigKey("test-energy.host")).toBe(true);
      expect(mgr.isRelevantConfigKey("other-plugin.host")).toBe(false);
    });
  });
});
