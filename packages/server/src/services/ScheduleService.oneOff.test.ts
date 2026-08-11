import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { ServiceError } from "../lib/ServiceError.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import { ScheduleService } from "./ScheduleService.ts";
import { Logger } from "../lib/Logger.ts";

describe("ScheduleService — one-off charges", () => {
  const SYDNEY = "Australia/Sydney";
  /** 2026-08-11 04:00Z = Tuesday 14:00 in Sydney (AEST, UTC+10). */
  const TUESDAY_AFTERNOON = "2026-08-11T04:00:00Z";
  const testLogger = new Logger("ScheduleService", "error");
  let db: AppDatabase;
  let service: ScheduleService;
  let time: FakeTime;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    service = new ScheduleService(db, testLogger);
    await db.setConfig("timezone", SYDNEY);
    // Default "now" for every test; individual tests move it with `time.now`
    time = new FakeTime(new Date(TUESDAY_AFTERNOON));
    await db.upsertVehicle({
      id: "v1",
      name: "Test Car",
      adapterType: "simulated",
      priority: 1,
      config: "{}",
      mode: "auto",
    });
  });

  afterEach(() => {
    time.restore();
    db.close();
  });

  const createOneOff = (
    overrides: Partial<Parameters<typeof service.createOneOff>[0]> = {},
  ) =>
    service.createOneOff({
      vehicleId: "v1",
      startTime: "23:30",
      durationMinutes: 180,
      chargeAmps: 16,
      chargeLimitPct: 80,
      ...overrides,
    });

  describe("createOneOff", () => {
    it("stores a dated charge schedule with the derived end time", async () => {
      const { schedule } = await createOneOff();

      expect(schedule.scheduleType).toBe("charge");
      expect(schedule.vehicleId).toBe("v1");
      expect(schedule.startTime).toBe("23:30");
      expect(schedule.endTime).toBe("02:30");
      expect(schedule.enabled).toBe(true);
      if (schedule.scheduleType !== "charge") {
        throw new Error("expected charge");
      }
      expect(schedule.oneOffDate).toBe("2026-08-11");
      expect(schedule.chargeAmps).toBe(16);
      expect(schedule.chargeLimitPct).toBe(80);
    });

    it("resolves the start time in the configured timezone", async () => {
      // 20:00Z on the 11th is already 06:00 on the 12th in Sydney, so the next
      // 23:30 there is on the 12th
      time.now = new Date("2026-08-11T20:00:00Z").getTime();
      const { schedule } = await createOneOff();
      if (schedule.scheduleType !== "charge") {
        throw new Error("expected charge");
      }
      expect(schedule.oneOffDate).toBe("2026-08-12");
    });

    it("uses tomorrow when the start time has already passed today", async () => {
      // Sydney 14:00 — a 10:00 start has gone
      const { schedule } = await createOneOff({ startTime: "10:00" });
      if (schedule.scheduleType !== "charge") {
        throw new Error("expected charge");
      }
      expect(schedule.oneOffDate).toBe("2026-08-12");
    });

    it("sets days to the start date's weekday", async () => {
      const { schedule } = await createOneOff();
      expect(schedule.days).toEqual(["tue"]);
    });

    it("replaces an existing pending one-off for the same vehicle", async () => {
      const first = await createOneOff();
      const second = await createOneOff({ durationMinutes: 60 });

      const { schedules } = await service.list();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].id).toBe(second.schedule.id);
      expect(schedules[0].id).not.toBe(first.schedule.id);
      expect(schedules[0].endTime).toBe("00:30");
    });

    it("leaves recurring schedules and other vehicles alone", async () => {
      await db.upsertVehicle({
        id: "v2",
        name: "Other Car",
        adapterType: "simulated",
        priority: 2,
        config: "{}",
        mode: "auto",
      });
      await service.create({
        scheduleType: "charge",
        vehicleId: "v1",
        startTime: "08:00",
        endTime: "12:00",
        days: ["mon"],
        chargeAmps: 10,
        chargeLimitPct: 70,
      });
      await createOneOff({ vehicleId: "v2" });

      await createOneOff();
      await createOneOff();

      const { schedules } = await service.list();
      // recurring + v2's one-off + v1's single one-off
      expect(schedules).toHaveLength(3);
      const oneOffs = schedules.filter((s) =>
        s.scheduleType === "charge" && s.oneOffDate
      );
      expect(oneOffs).toHaveLength(2);
    });

    it("rejects an unknown vehicle", async () => {
      await expect(createOneOff({ vehicleId: "nope" })).rejects.toBeInstanceOf(
        ServiceError,
      );
    });
  });

  describe("getActiveSchedules", () => {
    it("reports the one-off active inside its window", async () => {
      await createOneOff();

      // Sydney 2026-08-12 01:00 — past midnight, weekday no longer "tue"
      time.now = new Date("2026-08-11T15:00:00Z").getTime();
      const active = await service.getActiveSchedules();
      expect(active).toHaveLength(1);
      expect(active[0].startTime).toBe("23:30");
    });

    it("does not report it before the window opens", async () => {
      await createOneOff();

      // Sydney 2026-08-11 22:00
      time.now = new Date("2026-08-11T12:00:00Z").getTime();
      expect(await service.getActiveSchedules()).toHaveLength(0);
    });

    it("does not report it a week later", async () => {
      await createOneOff();

      // Sydney 2026-08-18 23:45 — same clock reading, next Tuesday
      time.now = new Date("2026-08-18T13:45:00Z").getTime();
      expect(await service.getActiveSchedules()).toHaveLength(0);
    });
  });

  describe("deleteExpiredOneOffs", () => {
    it("deletes a one-off whose window has elapsed", async () => {
      await createOneOff();

      const rows = await db.getSchedules();
      // Sydney 2026-08-12 03:00 — window ended at 02:30
      const remaining = await service.deleteExpiredOneOffs(
        rows,
        new Date("2026-08-11T17:00:00Z"),
        SYDNEY,
      );

      expect(remaining).toHaveLength(0);
      expect((await service.list()).schedules).toHaveLength(0);
    });

    it("keeps a one-off that is still running", async () => {
      await createOneOff();

      const rows = await db.getSchedules();
      // Sydney 2026-08-12 01:00
      const remaining = await service.deleteExpiredOneOffs(
        rows,
        new Date("2026-08-11T15:00:00Z"),
        SYDNEY,
      );

      expect(remaining).toHaveLength(1);
      expect((await service.list()).schedules).toHaveLength(1);
    });

    it("keeps a one-off that has not started", async () => {
      await createOneOff();

      const rows = await db.getSchedules();
      const remaining = await service.deleteExpiredOneOffs(
        rows,
        new Date(TUESDAY_AFTERNOON),
        SYDNEY,
      );

      expect(remaining).toHaveLength(1);
    });

    it("never deletes recurring schedules", async () => {
      await service.create({
        scheduleType: "charge",
        vehicleId: "v1",
        startTime: "08:00",
        endTime: "12:00",
        days: ["mon"],
        chargeAmps: 10,
        chargeLimitPct: 70,
      });
      await service.create({
        scheduleType: "blockout",
        startTime: "16:00",
        endTime: "21:00",
        days: ["mon", "tue"],
      });

      const rows = await db.getSchedules();
      const remaining = await service.deleteExpiredOneOffs(
        rows,
        new Date("2030-01-01T00:00:00Z"),
        SYDNEY,
      );

      expect(remaining).toHaveLength(2);
      expect((await service.list()).schedules).toHaveLength(2);
    });
  });

  describe("list", () => {
    it("reports oneOffDate as null for recurring charge schedules", async () => {
      await service.create({
        scheduleType: "charge",
        vehicleId: "v1",
        startTime: "08:00",
        endTime: "12:00",
        days: ["mon"],
        chargeAmps: 10,
        chargeLimitPct: 70,
      });

      const { schedules } = await service.list();
      const s = schedules[0];
      if (s.scheduleType !== "charge") throw new Error("expected charge");
      expect(s.oneOffDate).toBeNull();
    });
  });
});
