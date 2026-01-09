import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";
import { seed } from "./Demo.ts";

describe("demo seed", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
  });

  afterEach(() => {
    db.close();
  });

  const hourOf = (ts: string): number => Number(ts.slice(11, 13));

  it("inserts config values into empty DB", async () => {
    await seed(db);

    expect(await db.getConfig("home_latitude")).toBe("-33.8688");
    expect(await db.getConfig("home_longitude")).toBe("151.2093");
    expect(await db.getConfig("charging_enabled")).toBe("true");
    expect(await db.getConfig("solar_tracking_enabled")).toBe("true");
    expect(await db.getConfig("energy_adapter_type")).toBe("fronius_local");
  });

  it("inserts at least 1 vehicle", async () => {
    await seed(db);

    const vehicles = await db.getVehicles();
    expect(vehicles.length).toBeGreaterThanOrEqual(1);
    expect(vehicles[0].adapterType).toBe("simulated");
    expect(vehicles[0].name).toBeTruthy();
  });

  it("inserts at least 1 charge schedule and 1 blockout schedule", async () => {
    await seed(db);

    const schedules = await db.getSchedules();
    const chargeSchedules = schedules.filter((s) =>
      s.scheduleType === "charge"
    );
    const blockoutSchedules = schedules.filter((s) =>
      s.scheduleType === "blockout"
    );

    expect(chargeSchedules.length).toBeGreaterThanOrEqual(1);
    expect(blockoutSchedules.length).toBeGreaterThanOrEqual(1);
  });

  it("inserts energy_readings spanning at least 24 hours", async () => {
    await seed(db);

    const { rows, total } = await db.energy.getEnergyReadingsPaginated({
      limit: 10000,
      offset: 0,
    });
    expect(total).toBeGreaterThan(0);

    const timestamps = rows.map((r) => new Date(r.timestamp).getTime());
    const spanHours = (Math.max(...timestamps) - Math.min(...timestamps)) /
      3600_000;
    expect(spanHours).toBeGreaterThanOrEqual(24);
  });

  it("energy_readings have zero solar values during nighttime hours", async () => {
    await seed(db);

    // Nighttime in AEST (UTC+11): ~18:00-06:00 local = ~07:00-19:00 UTC
    // Check a window clearly at night: 09:00-18:00 UTC (20:00-05:00 AEDT — deep night)
    const { rows } = await db.energy.getEnergyReadingsPaginated({
      limit: 10000,
      offset: 0,
    });
    const nightRows = rows.filter((r) => {
      const h = hourOf(r.timestamp);
      return h >= 9 && h <= 18;
    });

    expect(nightRows.length).toBeGreaterThan(0);
    const allZero = nightRows.every((r) => r.solarProductionW === 0);
    expect(allZero).toBe(true);
  });

  it("energy_readings have positive solar values during daytime hours", async () => {
    await seed(db);

    // Daytime in AEST: ~06:00-18:00 local = ~20:00 prev UTC - 08:00 UTC
    // Check a window clearly during peak solar: 00:00-04:00 UTC (~11:00-15:00 AEDT)
    const { rows } = await db.energy.getEnergyReadingsPaginated({
      limit: 10000,
      offset: 0,
    });
    const dayRows = rows.filter((r) => {
      const h = hourOf(r.timestamp);
      return h >= 0 && h <= 4;
    });

    expect(dayRows.length).toBeGreaterThan(0);
    const hasPositive = dayRows.some((r) => r.solarProductionW > 0);
    expect(hasPositive).toBe(true);
  });

  it("inserts vehicle_charge_readings", async () => {
    await seed(db);

    const { total } = await db.vehicles.getVehicleChargeReadingsPaginated({
      limit: 1,
      offset: 0,
    });
    expect(total).toBeGreaterThan(0);
  });

  it("inserts controller_logs with at least start, stop, and adjust_amps actions", async () => {
    await seed(db);

    const { rows } = await db.logs.getControllerLogs({
      limit: 1000,
      offset: 0,
    });
    const actions = new Set(rows.map((r) => r.action));

    expect(actions.has("start")).toBe(true);
    expect(actions.has("stop")).toBe(true);
    expect(actions.has("adjust_amps")).toBe(true);
  });

  it("all timestamps are within the last 48 hours", async () => {
    await seed(db);

    const cutoffMs = Date.now() - 49 * 3600_000;
    const isFresh = (ts: string): boolean =>
      new Date(ts.replace(" ", "T") + "Z").getTime() >= cutoffMs;

    const { rows: energyRows } = await db.energy.getEnergyReadingsPaginated({
      limit: 10000,
      offset: 0,
    });
    expect(energyRows.every((r) => isFresh(r.timestamp))).toBe(true);

    const { rows: vcrRows } = await db.vehicles
      .getVehicleChargeReadingsPaginated({ limit: 10000, offset: 0 });
    expect(vcrRows.every((r) => isFresh(r.timestamp))).toBe(true);

    const { rows: clRows } = await db.logs.getControllerLogs({
      limit: 1000,
      offset: 0,
    });
    expect(clRows.every((r) => isFresh(r.timestamp))).toBe(true);
  });
});
