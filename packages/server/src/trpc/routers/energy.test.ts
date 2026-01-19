import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { EnergyAdapterManager } from "../../services/EnergyAdapterManager.ts";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { Logger } from "../../lib/Logger.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import type { EnergyPoller } from "../../services/EnergyPoller.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";
import { MockPoller } from "../../test-helpers/MockPoller.ts";

describe("Energy tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);
  const testLogger = new Logger("EnergyTest", "error");

  const REALTIME: EnergyData = {
    solarProductionW: 5000,
    gridPowerW: -2000,
    homeConsumptionW: 3000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const CUMULATIVE: CumulativeEnergyData = {
    solarProducedWh: 50000,
    gridImportedWh: 10000,
    gridExportedWh: 20000,
    dailySolarProducedWh: 5000,
    dailyGridImportWh: 1000,
    dailyGridExportWh: 2000,
  };

  let db: AppDatabase;
  let poller: MockPoller;
  let energyManager: EnergyAdapterManager;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    poller = new MockPoller();
    const emptyRegistry = new EnergyPluginRegistry();
    energyManager = new EnergyAdapterManager(db, emptyRegistry, testLogger);
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      energyManager,
      poller: poller as unknown as EnergyPoller,
    }));
  });

  afterEach(() => {
    db.close();
  });

  describe("energy.realtime", () => {
    it("throws when no data available", async () => {
      await expect(caller.energy.realtime()).rejects.toThrow(
        "No data available yet",
      );
    });

    it("returns latest snapshot", async () => {
      poller.setSnapshot(REALTIME, CUMULATIVE);

      const data = await caller.energy.realtime();
      expect(data.realtime.solarProductionW).toBe(5000);
      expect(data.cumulative.solarProducedWh).toBe(50000);
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("energy.history", () => {
    it("returns empty readings when no data", async () => {
      const data = await caller.energy.history({});
      expect(data.readings).toEqual([]);
    });

    it("returns recent readings from DB", async () => {
      await db.insertEnergyReading(REALTIME);
      await db.insertEnergyReading(REALTIME);

      const data = await caller.energy.history({});
      expect(data.readings).toHaveLength(2);
    });

    it("respects limit parameter", async () => {
      await Array.from({ length: 5 }).reduce(async (prev) => {
        await prev;
        await db.insertEnergyReading(REALTIME);
      }, Promise.resolve());

      const data = await caller.energy.history({ limit: 2 });
      expect(data.readings).toHaveLength(2);
    });
  });
});
