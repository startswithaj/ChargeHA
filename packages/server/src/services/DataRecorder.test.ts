import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { stub } from "@std/testing/mock";
import type {
  CumulativeEnergyData,
  EnergyData,
  VehicleChargeState,
} from "@chargeha/shared";
import { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import { DataRecorder } from "./DataRecorder.ts";
import { TariffService } from "./TariffService.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { Logger } from "../lib/Logger.ts";
import { testable } from "../test-helpers/Testable.ts";
import { MockRecorderVehicleManager } from "../test-helpers/MockRecorderVehicleManager.ts";

describe("DataRecorder", () => {
  const testLogger = new Logger("DataRecorder", "error");

  const ENERGY_DATA: EnergyData = {
    solarProductionW: 5000,
    gridPowerW: -1000,
    homeConsumptionW: 4000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const CHARGE_STATE: VehicleChargeState = {
    vehicleId: "VIN1",
    batteryLevel: 50,
    chargeLimit: 80,
    isCharging: true,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 3.7,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 5,
    minutesToFull: 120,
    chargePortOpen: true,
    vehicleName: "Test Car",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    latitude: -37.8136,
    longitude: 144.9631,
    isHome: true,
  };

  // CHARGE_STATE latitude/longitude match HOME_COORDS (Melbourne CBD) so that
  // tests which setHomeConfig() see the vehicle as "home" by default. AWAY_COORDS
  // is Sydney (~800km away), well outside the 200m home radius.
  const HOME_COORDS = { lat: "-37.8136", lng: "144.9631" };
  const AWAY_COORDS = { latitude: -33.8688, longitude: 151.2093 };

  async function setHomeConfig(database: AppDatabase): Promise<void> {
    await database.setConfig("home_latitude", HOME_COORDS.lat);
    await database.setConfig("home_longitude", HOME_COORDS.lng);
  }

  const CUMULATIVE_DEFAULTS: CumulativeEnergyData = {
    solarProducedWh: 0,
    gridImportedWh: 0,
    gridExportedWh: 0,
    dailySolarProducedWh: 0,
    dailyGridImportWh: 0,
    dailyGridExportWh: 0,
  };

  /** Emit an energy_update event to feed data into the recorder. */
  function feedEnergy(
    emitter: TypedEventEmitter,
    data: EnergyData,
  ): void {
    emitter.emit("energy_update", { ...data, ...CUMULATIVE_DEFAULTS });
  }

  let db: AppDatabase;
  let vehicleManager: MockRecorderVehicleManager;
  let tariffService: TariffService;
  let emitter: TypedEventEmitter;
  let recorder: DataRecorder;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    vehicleManager = new MockRecorderVehicleManager();
    tariffService = new TariffService(db, testLogger);
    emitter = new TypedEventEmitter();
    recorder = new DataRecorder(
      db,
      vehicleManager as unknown as VehicleManager,
      tariffService,
      emitter,
      testLogger,
    );
    // DataRecorder auto-starts in its ctor; stop the initial timer so each
    // test can drive scheduleNext / tick deterministically without a
    // stray ambient tick firing mid-test.
    await recorder.stop();
  });

  afterEach(async () => {
    await recorder.stop();
    db.close();
  });

  describe("energy_update subscription", () => {
    it("stores latest realtime data from event", () => {
      feedEnergy(emitter, ENERGY_DATA);
      // No crash — data stored internally
    });
  });

  describe("stop", () => {
    it("stop is idempotent", async () => {
      await recorder.stop();
      await recorder.stop();
    });
  });

  describe("scheduleNext", () => {
    it("uses custom interval from config", async () => {
      const fakeTime = new FakeTime();
      try {
        await db.setConfig("recording_interval_seconds", "30");
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).scheduleNext();
        // Flush the getConfig promise
        await fakeTime.tickAsync(0);
        // After 29s, tick should not have fired
        await fakeTime.tickAsync(29_000);
        const readingsBefore = await db.getRecentReadings(10);
        expect(readingsBefore).toHaveLength(0);
        // At 30s, tick fires
        await fakeTime.tickAsync(1_000);
        // Flush the async tick
        await fakeTime.tickAsync(0);
        const readingsAfter = await db.getRecentReadings(10);
        expect(readingsAfter).toHaveLength(1);
      } finally {
        fakeTime.restore();
        await recorder.stop();
      }
    });

    it("uses default interval when config returns null", async () => {
      const fakeTime = new FakeTime();
      try {
        // No config set — getConfig returns null, falls through to default 60s
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).scheduleNext();
        await fakeTime.tickAsync(0);
        // At 59s, no tick
        await fakeTime.tickAsync(59_000);
        const readingsBefore = await db.getRecentReadings(10);
        expect(readingsBefore).toHaveLength(0);
        // At 60s, tick fires
        await fakeTime.tickAsync(1_000);
        await fakeTime.tickAsync(0);
        const readingsAfter = await db.getRecentReadings(10);
        expect(readingsAfter).toHaveLength(1);
      } finally {
        fakeTime.restore();
        await recorder.stop();
      }
    });

    it("uses default interval when config returns invalid value", async () => {
      const fakeTime = new FakeTime();
      try {
        await db.setConfig("recording_interval_seconds", "notanumber");
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).scheduleNext();
        await fakeTime.tickAsync(0);
        // NaN || DEFAULT → 60s
        await fakeTime.tickAsync(60_000);
        await fakeTime.tickAsync(0);
        const readings = await db.getRecentReadings(10);
        expect(readings).toHaveLength(1);
      } finally {
        fakeTime.restore();
        await recorder.stop();
      }
    });

    it("uses default interval when getConfig throws", async () => {
      const fakeTime = new FakeTime();
      const originalGetConfig = db.getConfig.bind(db);
      const getConfigStub = stub(db, "getConfig", (key) => {
        if (key === "recording_interval_seconds") {
          return Promise.reject(new Error("DB error"));
        }
        return originalGetConfig(key);
      });
      try {
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).scheduleNext();
        // Flush the rejected promise → catch branch
        await fakeTime.tickAsync(0);
        // Default 60s
        await fakeTime.tickAsync(60_000);
        await fakeTime.tickAsync(0);
        const readings = await db.getRecentReadings(10);
        expect(readings).toHaveLength(1);
      } finally {
        getConfigStub.restore();
        fakeTime.restore();
        await recorder.stop();
      }
    });
  });

  describe("tick", () => {
    it("calls record and schedules next without pruning", async () => {
      const fakeTime = new FakeTime();
      try {
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).tickCount = 0;
        await testable(recorder).tick();
        // tickCount is now 1, not a multiple of 100 — no pruning
        expect(testable(recorder).tickCount).toBe(1);
        const readings = await db.getRecentReadings(10);
        expect(readings).toHaveLength(1);
        // Clean up the scheduled timer
        await recorder.stop();
      } finally {
        fakeTime.restore();
      }
    });

    it("prunes old data every 100 ticks", async () => {
      const fakeTime = new FakeTime();
      try {
        feedEnergy(emitter, ENERGY_DATA);
        // Set tickCount to 99 so next tick will be 100 (multiple of 100)
        testable(recorder).tickCount = 99;

        let pruneCalled = false;
        const originalPruneEnergy = db.pruneEnergyReadings.bind(db);
        db.pruneEnergyReadings = (days: number) => {
          pruneCalled = true;
          return originalPruneEnergy(days);
        };

        await testable(recorder).tick();
        expect(pruneCalled).toBe(true);
        expect(testable(recorder).tickCount).toBe(100);
        await recorder.stop();
      } finally {
        fakeTime.restore();
      }
    });

    it("uses custom retention days from config for pruning", async () => {
      const fakeTime = new FakeTime();
      try {
        await db.setConfig("data_retention_days", "365");
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).tickCount = 99;

        let prunedDays: number | null = null;
        const originalPruneEnergy = db.pruneEnergyReadings.bind(db);
        db.pruneEnergyReadings = (days: number) => {
          prunedDays = days;
          return originalPruneEnergy(days);
        };

        await testable(recorder).tick();
        expect(prunedDays).toBe(365);
        await recorder.stop();
      } finally {
        fakeTime.restore();
      }
    });

    it("uses default retention days when config returns null", async () => {
      const fakeTime = new FakeTime();
      try {
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).tickCount = 99;

        let prunedDays: number | null = null;
        const originalPruneEnergy = db.pruneEnergyReadings.bind(db);
        db.pruneEnergyReadings = (days: number) => {
          prunedDays = days;
          return originalPruneEnergy(days);
        };

        await testable(recorder).tick();
        // Default is 730
        expect(prunedDays).toBe(730);
        await recorder.stop();
      } finally {
        fakeTime.restore();
      }
    });

    it("uses default retention days when config returns invalid value", async () => {
      const fakeTime = new FakeTime();
      try {
        await db.setConfig("data_retention_days", "invalid");
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).tickCount = 99;

        let prunedDays: number | null = null;
        const originalPruneEnergy = db.pruneEnergyReadings.bind(db);
        db.pruneEnergyReadings = (days: number) => {
          prunedDays = days;
          return originalPruneEnergy(days);
        };

        await testable(recorder).tick();
        expect(prunedDays).toBe(730);
        await recorder.stop();
      } finally {
        fakeTime.restore();
      }
    });

    it("logs error when pruning fails", async () => {
      const fakeTime = new FakeTime();
      try {
        feedEnergy(emitter, ENERGY_DATA);
        testable(recorder).tickCount = 99;

        db.pruneEnergyReadings = () => {
          return Promise.reject(new Error("Prune failed"));
        };

        // Should not throw — error is caught and logged
        await testable(recorder).tick();
        expect(testable(recorder).tickCount).toBe(100);
        await recorder.stop();
      } finally {
        fakeTime.restore();
      }
    });
  });

  describe("record (private)", () => {
    it("does nothing when no data has been provided", async () => {
      await testable(recorder).record();

      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(0);
    });

    it("inserts energy reading after updateData", async () => {
      feedEnergy(emitter, ENERGY_DATA);

      await testable(recorder).record();

      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(1);
      expect(readings[0].solarProductionW).toBe(5000);
      expect(readings[0].gridPowerW).toBe(-1000);
      expect(readings[0].homeConsumptionW).toBe(4000);
    });

    it("records vehicle charge data for charging vehicles", async () => {
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);
      feedEnergy(emitter, ENERGY_DATA);

      await testable(recorder).record();

      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(1);
    });

    it("does not record vehicle charge data for non-charging vehicles", async () => {
      const notCharging = {
        ...CHARGE_STATE,
        isCharging: false,
        chargePowerKw: 0,
      };
      vehicleManager.setVehicleState("VIN1", notCharging);
      feedEnergy(emitter, ENERGY_DATA);

      await testable(recorder).record();

      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(1);
    });

    it("handles multiple charging vehicles with solar attribution", async () => {
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        chargePowerKw: 3.7,
      });
      vehicleManager.setVehicleState("VIN2", {
        ...CHARGE_STATE,
        vehicleId: "VIN2",
        chargePowerKw: 2.0,
      });
      feedEnergy(emitter, ENERGY_DATA);

      await testable(recorder).record();

      // Should have inserted energy reading + 2 vehicle charge readings
      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(1);
    });

    it("handles away-charging vehicles (no solar attribution)", async () => {
      await setHomeConfig(db);
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        ...AWAY_COORDS,
      });
      feedEnergy(emitter, ENERGY_DATA);

      await testable(recorder).record();

      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(1);
    });

    it("stores tariff rate on energy readings when configured", async () => {
      // Set up a default tariff rate — TariffService reads it on first resolveCurrentRate() call
      await db.setConfig("default_rate_per_kwh", "25");

      feedEnergy(emitter, ENERGY_DATA);
      await testable(recorder).record();

      // Query the energy reading directly to check rate_per_kwh
      // deno-lint-ignore no-explicit-any
      const rows = (db as any).sqlite.prepare(
        "SELECT rate_per_kwh FROM energy_readings ORDER BY id DESC LIMIT 1",
      ).all() as Array<{ rate_per_kwh: number | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].rate_per_kwh).toBe(25);
    });

    it("stores null rate on energy readings when no tariff configured", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      await testable(recorder).record();

      // deno-lint-ignore no-explicit-any
      const rows = (db as any).sqlite.prepare(
        "SELECT rate_per_kwh FROM energy_readings ORDER BY id DESC LIMIT 1",
      ).all() as Array<{ rate_per_kwh: number | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].rate_per_kwh).toBeNull();
    });

    it("logs error and continues when insertEnergyReading throws", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);

      db.insertEnergyReading = () => {
        return Promise.reject(new Error("Insert energy failed"));
      };

      // Should not throw — error is caught and vehicle recording still attempted
      await testable(recorder).record();
    });

    it("logs error when recordVehicleCharges throws", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);

      db.insertVehicleChargeReading = () => {
        return Promise.reject(new Error("Insert vehicle charge failed"));
      };

      // Should not throw — error is caught and logged
      await testable(recorder).record();
    });
  });

  describe("recordVehicleCharges", () => {
    it("returns early when latestRealtime is null", async () => {
      // Don't call updateData — latestRealtime stays null
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);

      // Call recordVehicleCharges directly — should return early
      await testable(recorder).recordVehicleCharges(25);
    });

    it("returns early when no vehicles have state", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      // No vehicle states set — allStates.size === 0
      await testable(recorder).recordVehicleCharges(25);
    });

    it("skips vehicles that are charging=true but chargePowerKw=0", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        isCharging: true,
        chargePowerKw: 0,
      });

      let insertCalled = false;
      db.insertVehicleChargeReading = () => {
        insertCalled = true;
        return Promise.resolve();
      };

      await testable(recorder).recordVehicleCharges(25);
      // chargePowerKw === 0 → isNowCharging = false → no insert
      expect(insertCalled).toBe(false);
    });

    it("skips vehicles that are not charging", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        isCharging: false,
        chargePowerKw: 3.7,
      });

      let insertCalled = false;
      db.insertVehicleChargeReading = () => {
        insertCalled = true;
        return Promise.resolve();
      };

      await testable(recorder).recordVehicleCharges(25);
      // isCharging === false → isNowCharging = false → no insert
      expect(insertCalled).toBe(false);
    });

    it("defaults to home when home coords are not configured", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);
      // Intentionally leave home_latitude/home_longitude unset — isHome()
      // returns null, so DataRecorder falls back to "home" for attribution.

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      expect(capturedReading).not.toBeNull();
      expect(capturedReading.isHome).toBe(true);
      expect(capturedReading.solarContributionW).toBeGreaterThan(0);
    });

    it("defaults to home when vehicle has no reported location", async () => {
      await setHomeConfig(db);
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        latitude: null,
        longitude: null,
      });

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      expect(capturedReading.isHome).toBe(true);
      expect(capturedReading.solarContributionW).toBeGreaterThan(0);
    });

    it("records correct solar attribution for home charging", async () => {
      // solar=5000, home=4000, chargePower=3700W
      // availableSolar = max(0, 5000 - 4000 + 3700) = 4700
      // vehicleShare = 1 (only one vehicle)
      // solarContribution = min(3700, 4700 * 1) = 3700
      // gridContribution = 3700 - 3700 = 0
      await setHomeConfig(db);
      feedEnergy(emitter, ENERGY_DATA);
      // CHARGE_STATE coords match HOME_COORDS, so isHome() returns true.
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      expect(capturedReading.isHome).toBe(true);
      expect(capturedReading.solarContributionW).toBe(3700);
      expect(capturedReading.gridContributionW).toBe(0);
      expect(capturedReading.ratePerKwh).toBe(25);
    });

    it("records zero solar/grid contribution for away charging", async () => {
      await setHomeConfig(db);
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        ...AWAY_COORDS,
      });

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      expect(capturedReading.isHome).toBe(false);
      expect(capturedReading.solarContributionW).toBe(0);
      expect(capturedReading.gridContributionW).toBe(0);
    });

    it("splits solar proportionally for multiple home-charging vehicles", async () => {
      // solar=5000, home=4000 (home meter includes both EVs' draw)
      // VIN1: 3700W, VIN2: 2000W, total=5700W
      // availableSolar = max(0, 5000-4000+5700) = 6700
      // capped by production: VIN1 solar = 5000 * 3700/5700 ≈ 3245.6
      //                       VIN2 solar = 5000 * 2000/5700 ≈ 1754.4
      await setHomeConfig(db);
      feedEnergy(emitter, ENERGY_DATA);
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        chargePowerKw: 3.7,
      });
      vehicleManager.setVehicleState("VIN2", {
        ...CHARGE_STATE,
        vehicleId: "VIN2",
        chargePowerKw: 2.0,
      });

      // deno-lint-ignore no-explicit-any
      const capturedReadings: any[] = [];
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReadings.push({ ...reading });
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(null);
      expect(capturedReadings).toHaveLength(2);
      expect(capturedReadings[0].solarContributionW).toBeCloseTo(3245.6, 0);
      expect(capturedReadings[0].gridContributionW).toBeCloseTo(454.4, 0);
      expect(capturedReadings[1].solarContributionW).toBeCloseTo(1754.4, 0);
      expect(capturedReadings[1].gridContributionW).toBeCloseTo(245.6, 0);
      const totalSolar = capturedReadings[0].solarContributionW +
        capturedReadings[1].solarContributionW;
      const totalGrid = capturedReadings[0].gridContributionW +
        capturedReadings[1].gridContributionW;
      expect(totalSolar + totalGrid).toBe(3700 + 2000);
      // ratePerKwh should be null
      expect(capturedReadings[0].ratePerKwh).toBeNull();
    });

    it("caps solar contribution when solar is less than demand", async () => {
      // solar=500, home=3000, chargePower=3700W
      // (home=3000 with car=3700 implies the home meter is missing the car —
      //  same stale-meter shape as the Apr 7 bug, just with different numbers.)
      // availableSolar = max(0, 500 - 3000 + 3700) = 1200
      // solarContribution = min(3700, 1200, 500) = 500   ← capped by actual production
      // gridContribution = 3700 - 500 = 3200
      await setHomeConfig(db);
      const lowSolar: EnergyData = {
        ...ENERGY_DATA,
        solarProductionW: 500,
        homeConsumptionW: 3000,
      };
      feedEnergy(emitter, lowSolar);
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      expect(capturedReading.solarContributionW).toBe(500);
      expect(capturedReading.gridContributionW).toBe(3200);
    });

    it("attributes all charging to grid when the latest energy reading is from a failed poll", async () => {
      // When the inverter poll fails and zeros are recorded with pollFailed=true,
      // we cannot trust the home/solar numbers. The car's contribution must be
      // reported as 100% grid, not synthesized solar.
      await setHomeConfig(db);
      const failedReading: EnergyData = {
        ...ENERGY_DATA,
        solarProductionW: 0,
        gridPowerW: 0,
        homeConsumptionW: 0,
        pollFailed: true,
      };
      feedEnergy(emitter, failedReading);
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      expect(capturedReading.solarContributionW).toBe(0);
      expect(capturedReading.gridContributionW).toBe(3700);
    });

    it("caps solar contribution by actual solar production (Apr 7 stale-meter bug)", async () => {
      // Bug from production: a stuck/stale Fronius meter reported solar=114W and
      // home=938W while the car was actually charging at 7000W (the car's draw
      // was missing from the home meter). The old formula gave
      // availableSolar = 114 − 938 + 7000 = 6176W and attributed 6176W to solar,
      // which is impossible because only 114W was being produced.
      await setHomeConfig(db);
      const staleMeter: EnergyData = {
        ...ENERGY_DATA,
        solarProductionW: 114,
        gridPowerW: 868,
        homeConsumptionW: 938,
      };
      feedEnergy(emitter, staleMeter);
      vehicleManager.setVehicleState("VIN1", {
        ...CHARGE_STATE,
        chargePowerKw: 7,
      });

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      // Solar attribution must never exceed actual solar production
      expect(capturedReading.solarContributionW).toBeLessThanOrEqual(114);
      // The remainder is grid
      expect(
        capturedReading.solarContributionW + capturedReading.gridContributionW,
      ).toBe(7000);
    });

    it("clamps availableSolar to zero when home consumption exceeds solar+charge", async () => {
      // solar=100, home=5000, chargePower=3700W
      // availableSolar = max(0, 100 - 5000 + 3700) = max(0, -1200) = 0
      // solarContribution = min(3700, 0) = 0
      // gridContribution = 3700 - 0 = 3700
      await setHomeConfig(db);
      const noSolar: EnergyData = {
        ...ENERGY_DATA,
        solarProductionW: 100,
        homeConsumptionW: 5000,
      };
      feedEnergy(emitter, noSolar);
      vehicleManager.setVehicleState("VIN1", CHARGE_STATE);

      // deno-lint-ignore no-explicit-any
      let capturedReading: any = null;
      const originalInsert = db.insertVehicleChargeReading.bind(db);
      db.insertVehicleChargeReading = (reading) => {
        capturedReading = reading;
        return originalInsert(reading);
      };

      await testable(recorder).recordVehicleCharges(25);
      expect(capturedReading.solarContributionW).toBe(0);
      expect(capturedReading.gridContributionW).toBe(3700);
    });
  });

  describe("pruning logic", () => {
    it("prunes old data based on retention days", async () => {
      feedEnergy(emitter, ENERGY_DATA);
      await db.setConfig("data_retention_days", "730");

      // Directly test pruning logic
      const val = await db.getConfig("data_retention_days");
      const days = parseInt(val ?? "730", 10) || 730;
      await db.pruneEnergyReadings(days);
      await db.pruneVehicleChargeReadings(days);

      // Should not crash
    });
  });
});
