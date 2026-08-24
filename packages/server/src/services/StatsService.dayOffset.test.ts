import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { sql } from "drizzle-orm";
import { AppDatabase } from "../db/AppDatabase.ts";
import { StatsService } from "./StatsService.ts";

describe("stats day offset follows the requested date", () => {
  let db: AppDatabase;
  let statsService: StatsService;
  let time: FakeTime;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    statsService = new StatsService(db);
    time = new FakeTime(new Date("2026-01-15T00:00:00Z"));
  });

  afterEach(() => {
    time.restore();
    db.close();
  });

  const seed = async (timestamp: string, chargePowerW: number) => {
    await db.db.run(sql`
      INSERT INTO vehicle_charge_readings
        (timestamp, vehicle_id, charge_power_w, charge_amps,
         solar_contribution_w, grid_contribution_w, is_home)
      VALUES (${timestamp}, 'v1', ${chargePowerW}, 16, 0, ${chargePowerW}, 1)
    `);
  };

  it("uses the offset of the requested day, not of today", async () => {
    await db.setConfig("timezone", "Australia/Sydney");
    await seed("2026-07-15 13:30:00", 3600);
    await seed("2026-07-14 13:30:00", 1800);
    await seed("2026-07-15 02:00:00", 6000);

    const stats = await statsService.buildDayStats(
      "2026-07-15",
      undefined,
      false,
    );

    expect(stats.totalChargedWh).toBe(160);
  });
});
