import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { ScheduleService } from "../../services/ScheduleService.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import type { Logger } from "../../lib/Logger.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Schedules tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

  const VALID_CHARGE_SCHEDULE = {
    scheduleType: "charge" as const,
    vehicleId: "VIN1",
    startTime: "08:00",
    endTime: "16:00",
    days: ["mon", "tue", "wed"] as [DayCode, ...DayCode[]],
    chargeAmps: 16,
    chargeLimitPct: 80,
  };

  const VALID_BLOCKOUT_SCHEDULE = {
    scheduleType: "blockout" as const,
    startTime: "18:00",
    endTime: "21:00",
    days: ["mon", "tue", "wed", "thu", "fri"] as [DayCode, ...DayCode[]],
  };

  const mockLogger: Logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  } as unknown as Logger;

  let db: AppDatabase;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    const scheduleService = new ScheduleService(db, mockLogger);
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      db,
      scheduleService,
      logger: mockLogger,
    }));
  });

  afterEach(() => {
    db.close();
  });

  describe("schedule.list", () => {
    it("returns empty list initially", async () => {
      const data = await caller.schedule.list();
      expect(data.schedules).toEqual([]);
    });
  });

  describe("schedule.create", () => {
    it("creates a charge schedule", async () => {
      const data = await caller.schedule.create(VALID_CHARGE_SCHEDULE);
      expect(data.schedule.scheduleType).toBe("charge");
      expect(data.schedule.vehicleId).toBe("VIN1");
      expect(data.schedule.startTime).toBe("08:00");
      expect(data.schedule.chargeAmps).toBe(16);
      expect(data.schedule.chargeLimitPct).toBe(80);
      expect(data.schedule.enabled).toBe(true);
    });

    it("creates a blockout schedule", async () => {
      const data = await caller.schedule.create(VALID_BLOCKOUT_SCHEDULE);
      expect(data.schedule.scheduleType).toBe("blockout");
      expect(data.schedule.vehicleId).toBeNull();
    });

    it("rejects charge schedule without vehicleId", async () => {
      await expect(
        caller.schedule.create({
          ...VALID_CHARGE_SCHEDULE,
          vehicleId: undefined,
        }),
      ).rejects.toThrow("vehicleId is required");
    });
  });

  describe("schedule.update", () => {
    it("updates a schedule", async () => {
      const created = await caller.schedule.create(VALID_CHARGE_SCHEDULE);
      const data = await caller.schedule.update({
        id: created.schedule.id,
        startTime: "09:00",
      });
      expect(data.schedule.startTime).toBe("09:00");
    });

    it("toggles enabled state", async () => {
      const created = await caller.schedule.create(VALID_CHARGE_SCHEDULE);
      const data = await caller.schedule.update({
        id: created.schedule.id,
        enabled: false,
      });
      expect(data.schedule.enabled).toBe(false);
    });

    it("throws NOT_FOUND for nonexistent schedule", async () => {
      await expect(
        caller.schedule.update({ id: "nonexistent", startTime: "09:00" }),
      ).rejects.toThrow("Schedule not found");
    });
  });

  describe("schedule.delete", () => {
    it("deletes a schedule", async () => {
      const created = await caller.schedule.create(VALID_CHARGE_SCHEDULE);
      const result = await caller.schedule.delete({
        id: created.schedule.id,
      });
      expect(result.success).toBe(true);

      // Verify deleted
      const list = await caller.schedule.list();
      expect(list.schedules).toHaveLength(0);
    });

    it("throws NOT_FOUND for nonexistent schedule", async () => {
      await expect(
        caller.schedule.delete({ id: "nonexistent" }),
      ).rejects.toThrow("Schedule not found");
    });
  });
});
