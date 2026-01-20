import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { VehicleFetchLogger } from "./VehicleFetchLogger.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleChargeState } from "@chargeha/shared";
import { throwingMock } from "../test-helpers/throwingMock.ts";
import { MockDb } from "../test-helpers/MockDb.ts";
import { CapturingLogger } from "../test-helpers/CapturingLogger.ts";

describe("VehicleFetchLogger", () => {
  const sampleState: VehicleChargeState = {
    vehicleId: "VIN1",
    vehicleName: "Tesla",
    batteryLevel: 42,
    chargeLimit: 80,
    isCharging: true,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 11,
    chargerVoltage: 240,
    chargerPhases: 3,
    energyAddedKwh: 4.2,
    minutesToFull: 90,
    chargePortOpen: true,
    lastUpdated: "2026-04-24T00:00:00.000Z",
    latitude: -33.8688,
    longitude: 151.2093,
    isHome: true,
  };

  let eventEmitter: TypedEventEmitter;
  let db: MockDb;
  let logger: CapturingLogger;

  beforeEach(() => {
    eventEmitter = new TypedEventEmitter();
    db = new MockDb();
    logger = new CapturingLogger("VehicleFetchLogger", "error");
    const dbMock = throwingMock<AppDatabase>("AppDatabase", {
      insertVehiclePollLog: (input) => db.insertVehiclePollLog(input),
    });
    // Constructed for its side effect (subscribes to eventEmitter).
    new VehicleFetchLogger(dbMock, eventEmitter, logger);
  });

  it("writes a poll log row on vehicle_update", () => {
    eventEmitter.emit("vehicle_update", sampleState);

    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toEqual({
      vehicleId: "VIN1",
      vehicleName: "Tesla",
      isOnline: true,
      isPluggedIn: true,
      isCharging: true,
      batteryLevel: 42,
      chargeLimit: 80,
      chargeAmps: 16,
      chargeAmpsMax: 32,
      chargePowerKw: 11,
      chargerVoltage: 240,
      energyAddedKwh: 4.2,
      minutesToFull: 90,
      isHome: true,
    });
  });

  it("writes one row per emitted update", () => {
    eventEmitter.emit("vehicle_update", sampleState);
    eventEmitter.emit("vehicle_update", { ...sampleState, batteryLevel: 50 });
    eventEmitter.emit("vehicle_update", { ...sampleState, batteryLevel: 55 });

    expect(db.inserts).toHaveLength(3);
    expect(db.inserts.map((r) => r.batteryLevel)).toEqual([42, 50, 55]);
  });

  it("logs an error when the insert rejects, without throwing", async () => {
    db.shouldReject = true;

    eventEmitter.emit("vehicle_update", sampleState);

    // Allow the rejected insert promise to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0].msg).toContain("Tesla");
  });

  it("ignores non vehicle_update events", () => {
    eventEmitter.emit("energy_poll_success", {});
    eventEmitter.emit("vehicle_plug_changed", {
      vehicleId: "VIN1",
      vehicleName: "Tesla",
      isPluggedIn: true,
      isHome: null,
    });

    expect(db.inserts).toHaveLength(0);
  });
});
