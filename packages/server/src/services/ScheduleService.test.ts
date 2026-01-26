import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ServiceError } from "../lib/ServiceError.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import { ScheduleService } from "./ScheduleService.ts";
import { Logger } from "../lib/Logger.ts";

describe("ScheduleService", () => {
  const testLogger = new Logger("ScheduleService", "error");
  let db: AppDatabase;
  let service: ScheduleService;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    service = new ScheduleService(db, testLogger);
  });

  afterEach(() => {
    db.close();
  });

  // ----- list -----

  describe("list", () => {
    it("returns empty array when no schedules exist", async () => {
      const result = await service.list();
      expect(result).toEqual({ schedules: [] });
    });

    it("returns charge schedules with all fields", async () => {
      await db.createSchedule({
        id: "s1",
        vehicleId: "v1",
        scheduleType: "charge",
        startTime: "08:00",
        endTime: "12:00",
        days: ["mon", "tue"],
        chargeAmps: 16,
        chargeLimitPct: 80,
      });

      const result = await service.list();
      expect(result.schedules).toHaveLength(1);
      const s = result.schedules[0];
      expect(s.scheduleType).toBe("charge");
      expect(s.vehicleId).toBe("v1");
      expect(s.chargeAmps).toBe(16);
      expect(s.chargeLimitPct).toBe(80);
      expect(s.startTime).toBe("08:00");
      expect(s.endTime).toBe("12:00");
      expect(s.days).toEqual(["mon", "tue"]);
    });

    it("returns blockout schedules without charge fields", async () => {
      await db.createSchedule({
        id: "s2",
        vehicleId: null,
        scheduleType: "blockout",
        startTime: "22:00",
        endTime: "06:00",
        days: ["sat", "sun"],
        chargeAmps: null,
        chargeLimitPct: null,
      });

      const result = await service.list();
      expect(result.schedules).toHaveLength(1);
      const s = result.schedules[0];
      expect(s.scheduleType).toBe("blockout");
      expect(s.vehicleId).toBeNull();
      expect(s).not.toHaveProperty("chargeAmps");
      expect(s).not.toHaveProperty("chargeLimitPct");
    });

    it("returns both charge and blockout schedules", async () => {
      await db.createSchedule({
        id: "s1",
        vehicleId: "v1",
        scheduleType: "charge",
        startTime: "08:00",
        endTime: "12:00",
        days: ["mon"],
        chargeAmps: 10,
        chargeLimitPct: 90,
      });
      await db.createSchedule({
        id: "s2",
        vehicleId: null,
        scheduleType: "blockout",
        startTime: "22:00",
        endTime: "06:00",
        days: ["sun"],
        chargeAmps: null,
        chargeLimitPct: null,
      });

      const result = await service.list();
      expect(result.schedules).toHaveLength(2);
      expect(result.schedules[0].scheduleType).toBe("charge");
      expect(result.schedules[1].scheduleType).toBe("blockout");
    });
  });

  // ----- create -----

  describe("create", () => {
    it("creates a charge schedule with valid input", async () => {
      const result = await service.create({
        scheduleType: "charge",
        vehicleId: "v1",
        startTime: "06:00",
        endTime: "09:00",
        days: ["mon", "wed", "fri"],
        chargeAmps: 32,
        chargeLimitPct: 80,
      });

      expect(result.schedule.scheduleType).toBe("charge");
      expect(result.schedule.vehicleId).toBe("v1");
      expect(result.schedule.chargeAmps).toBe(32);
      expect(result.schedule.chargeLimitPct).toBe(80);
    });

    it("creates a blockout schedule (skips charge validation)", async () => {
      const result = await service.create({
        scheduleType: "blockout",
        startTime: "22:00",
        endTime: "06:00",
        days: ["sat", "sun"],
      });

      expect(result.schedule.scheduleType).toBe("blockout");
      expect(result.schedule.vehicleId).toBeNull();
      expect(result.schedule).not.toHaveProperty("chargeAmps");
      expect(result.schedule).not.toHaveProperty("chargeLimitPct");
    });

    it("throws BAD_REQUEST when charge schedule has no vehicleId", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeAmps: 10,
          chargeLimitPct: 80,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("vehicleId");
      }
    });

    it("throws BAD_REQUEST when charge schedule has null vehicleId", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          vehicleId: null,
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeAmps: 10,
          chargeLimitPct: 80,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("vehicleId");
      }
    });

    it("throws BAD_REQUEST when chargeAmps is missing", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          vehicleId: "v1",
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeLimitPct: 80,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("chargeAmps");
      }
    });

    it("throws BAD_REQUEST when chargeAmps is zero", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          vehicleId: "v1",
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeAmps: 0,
          chargeLimitPct: 80,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("chargeAmps");
      }
    });

    it("throws BAD_REQUEST when chargeAmps is negative", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          vehicleId: "v1",
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeAmps: -5,
          chargeLimitPct: 80,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("chargeAmps");
      }
    });

    it("throws BAD_REQUEST when chargeLimitPct is missing", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          vehicleId: "v1",
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeAmps: 10,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("chargeLimitPct");
      }
    });

    it("throws BAD_REQUEST when chargeLimitPct is zero", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          vehicleId: "v1",
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeAmps: 10,
          chargeLimitPct: 0,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("chargeLimitPct");
      }
    });

    it("throws BAD_REQUEST when chargeLimitPct exceeds 100", async () => {
      try {
        await service.create({
          scheduleType: "charge",
          vehicleId: "v1",
          startTime: "06:00",
          endTime: "09:00",
          days: ["mon"],
          chargeAmps: 10,
          chargeLimitPct: 101,
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("BAD_REQUEST");
        expect((e as ServiceError).message).toContain("chargeLimitPct");
      }
    });

    it("throws INTERNAL_SERVER_ERROR when getSchedule returns null after create", async () => {
      const originalGetSchedule = db.getSchedule.bind(db);
      db.getSchedule = () => Promise.resolve(null);

      try {
        await service.create({
          scheduleType: "blockout",
          startTime: "22:00",
          endTime: "06:00",
          days: ["mon"],
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("INTERNAL_SERVER_ERROR");
        expect((e as ServiceError).message).toContain("Failed to create");
      } finally {
        db.getSchedule = originalGetSchedule;
      }
    });

    it("accepts chargeLimitPct at boundary values 1 and 100", async () => {
      const r1 = await service.create({
        scheduleType: "charge",
        vehicleId: "v1",
        startTime: "06:00",
        endTime: "09:00",
        days: ["mon"],
        chargeAmps: 1,
        chargeLimitPct: 1,
      });
      expect(r1.schedule.chargeLimitPct).toBe(1);

      const r2 = await service.create({
        scheduleType: "charge",
        vehicleId: "v1",
        startTime: "10:00",
        endTime: "12:00",
        days: ["tue"],
        chargeAmps: 32,
        chargeLimitPct: 100,
      });
      expect(r2.schedule.chargeLimitPct).toBe(100);
    });
  });

  // ----- update -----

  describe("update", () => {
    it("updates an existing schedule", async () => {
      await db.createSchedule({
        id: "s1",
        vehicleId: "v1",
        scheduleType: "charge",
        startTime: "06:00",
        endTime: "09:00",
        days: ["mon"],
        chargeAmps: 10,
        chargeLimitPct: 80,
      });

      const result = await service.update({
        id: "s1",
        startTime: "07:00",
        endTime: "10:00",
        chargeAmps: 16,
      });

      expect(result.schedule.startTime).toBe("07:00");
      expect(result.schedule.endTime).toBe("10:00");
      expect(result.schedule.chargeAmps).toBe(16);
    });

    it("throws NOT_FOUND when schedule does not exist", async () => {
      try {
        await service.update({ id: "nonexistent", startTime: "07:00" });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("NOT_FOUND");
      }
    });

    it("throws INTERNAL_SERVER_ERROR when getSchedule returns null after update", async () => {
      await db.createSchedule({
        id: "s1",
        vehicleId: null,
        scheduleType: "blockout",
        startTime: "22:00",
        endTime: "06:00",
        days: ["sat"],
        chargeAmps: null,
        chargeLimitPct: null,
      });

      const originalGetSchedule = db.getSchedule.bind(db);
      let callCount = 0;
      db.getSchedule = (id: string) => {
        callCount++;
        // First call (existence check) returns the row; second call (after update) returns null
        if (callCount === 1) return originalGetSchedule(id);
        return Promise.resolve(null);
      };

      try {
        await service.update({ id: "s1", startTime: "23:00" });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("INTERNAL_SERVER_ERROR");
        expect((e as ServiceError).message).toContain("not found after update");
      } finally {
        db.getSchedule = originalGetSchedule;
      }
    });

    it("updates enabled field", async () => {
      await db.createSchedule({
        id: "s1",
        vehicleId: null,
        scheduleType: "blockout",
        startTime: "22:00",
        endTime: "06:00",
        days: ["mon"],
        chargeAmps: null,
        chargeLimitPct: null,
      });

      const result = await service.update({ id: "s1", enabled: false });
      expect(result.schedule.enabled).toBe(false);
    });
  });

  // ----- delete -----

  describe("delete", () => {
    it("deletes an existing schedule", async () => {
      await db.createSchedule({
        id: "s1",
        vehicleId: null,
        scheduleType: "blockout",
        startTime: "22:00",
        endTime: "06:00",
        days: ["mon"],
        chargeAmps: null,
        chargeLimitPct: null,
      });

      const result = await service.delete("s1");
      expect(result).toEqual({ success: true });

      const remaining = await service.list();
      expect(remaining.schedules).toHaveLength(0);
    });

    it("throws NOT_FOUND when schedule does not exist", async () => {
      try {
        await service.delete("nonexistent");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe("NOT_FOUND");
      }
    });
  });
});
