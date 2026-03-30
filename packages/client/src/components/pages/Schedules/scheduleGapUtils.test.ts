import { describe, expect, it } from "vitest";
import type { Schedule } from "@chargeha/shared";
import {
  findNextGap,
  SLOTS,
  slotToTime,
  timeToSlot,
} from "./scheduleGapUtils.ts";

describe("scheduleGapUtils", () => {
  const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

  const makeCharge = (
    vehicleId: string,
    startTime: string,
    endTime: string,
  ): Schedule => ({
    id: crypto.randomUUID(),
    vehicleId,
    scheduleType: "charge",
    startTime,
    endTime,
    days: [...ALL_DAYS],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
  });

  const makeBlockout = (startTime: string, endTime: string): Schedule => ({
    id: crypto.randomUUID(),
    vehicleId: null,
    scheduleType: "blockout",
    startTime,
    endTime,
    days: [...ALL_DAYS],
    enabled: true,
  });

  describe("timeToSlot", () => {
    it("converts midnight to slot 0", () => {
      expect(timeToSlot("00:00")).toBe(0);
    });

    it("converts 06:00 to slot 24", () => {
      expect(timeToSlot("06:00")).toBe(24);
    });

    it("converts 23:45 to slot 95", () => {
      expect(timeToSlot("23:45")).toBe(95);
    });

    it("rounds down to nearest quarter", () => {
      expect(timeToSlot("06:07")).toBe(24);
      expect(timeToSlot("06:14")).toBe(24);
      expect(timeToSlot("06:15")).toBe(25);
    });
  });

  describe("slotToTime", () => {
    it("converts slot 0 to 00:00", () => {
      expect(slotToTime(0)).toBe("00:00");
    });

    it("converts slot 24 to 06:00", () => {
      expect(slotToTime(24)).toBe("06:00");
    });

    it("converts slot 95 to 23:45", () => {
      expect(slotToTime(95)).toBe("23:45");
    });

    it("wraps around past 96 slots", () => {
      expect(slotToTime(SLOTS)).toBe("00:00");
      expect(slotToTime(SLOTS + 4)).toBe("01:00");
    });

    it("handles negative slots by wrapping", () => {
      expect(slotToTime(-1)).toBe("23:45");
    });
  });

  describe("findNextGap", () => {
    describe("no existing schedules", () => {
      it("returns 00:00-06:00 default for charge type", () => {
        const result = findNextGap([], "charge", "v1");
        expect(result).toEqual({ startTime: "00:00", endTime: "06:00" });
      });

      it("returns 16:00-22:00 default for blockout type", () => {
        const result = findNextGap([], "blockout", null);
        expect(result).toEqual({ startTime: "16:00", endTime: "22:00" });
      });
    });

    describe("single schedule leaves a gap", () => {
      it("finds the gap when one charge schedule occupies early morning", () => {
        const schedules = [makeCharge("v1", "00:00", "06:00")];
        const result = findNextGap(schedules, "charge", "v1");
        // Gap is 06:00-00:00 (18 hours = 72 slots), capped at 6 hours
        expect(result.startTime).toBe("06:00");
        expect(timeToSlot(result.endTime) - timeToSlot(result.startTime)).toBe(
          24,
        ); // 6 hours cap
      });

      it("finds the gap when one blockout occupies evening", () => {
        const schedules = [makeBlockout("18:00", "22:00")];
        const result = findNextGap(schedules, "blockout", null);
        // Largest gap is 22:00-18:00 (20 hours), capped at 6 hours
        expect(result.startTime).toBe("22:00");
      });
    });

    describe("multiple schedules", () => {
      it("finds the largest gap between multiple charge schedules", () => {
        const schedules = [
          makeCharge("v1", "00:00", "04:00"),
          makeCharge("v1", "06:00", "08:00"),
          makeCharge("v1", "10:00", "20:00"),
        ];
        const result = findNextGap(schedules, "charge", "v1");
        // Gaps: 04:00-06:00 (2h), 08:00-10:00 (2h), 20:00-00:00 (4h)
        // Largest is 20:00-00:00
        expect(result.startTime).toBe("20:00");
        expect(result.endTime).toBe("00:00");
      });

      it("ignores schedules for other vehicles", () => {
        const schedules = [
          makeCharge("v1", "00:00", "12:00"),
          makeCharge("v2", "12:00", "18:00"),
        ];
        // Looking for v2 gaps — only the v2 schedule matters
        const result = findNextGap(schedules, "charge", "v2");
        // v2 occupies 12:00-18:00, so gap is 18:00-12:00 (18 hours), capped
        expect(result.startTime).toBe("18:00");
      });

      it("ignores charge schedules when finding blockout gaps", () => {
        const schedules = [
          makeCharge("v1", "00:00", "12:00"),
          makeBlockout("12:00", "14:00"),
        ];
        const result = findNextGap(schedules, "blockout", null);
        // Only blockout 12:00-14:00 is relevant, gap is 14:00-12:00
        expect(result.startTime).toBe("14:00");
      });
    });

    describe("overnight schedules", () => {
      it("handles overnight schedule (end < start)", () => {
        const schedules = [makeCharge("v1", "22:00", "06:00")];
        const result = findNextGap(schedules, "charge", "v1");
        // Occupied 22:00-06:00, free 06:00-22:00 (16h), capped at 6h
        expect(result.startTime).toBe("06:00");
        expect(result.endTime).toBe("12:00");
      });
    });

    describe("wrap-around gap merge", () => {
      it("merges free slots at end and start of day into one gap", () => {
        const schedules = [makeCharge("v1", "06:00", "20:00")];
        const result = findNextGap(schedules, "charge", "v1");
        // Free: 20:00-06:00 (10 hours), which wraps around midnight
        // Should be merged into one gap, capped at 6h
        expect(result.startTime).toBe("20:00");
        expect(result.endTime).toBe("02:00");
      });
    });

    describe("fully occupied", () => {
      it("returns default when all slots are occupied", () => {
        const schedules = [
          makeCharge("v1", "00:00", "12:00"),
          makeCharge("v1", "12:00", "00:00"),
        ];
        const result = findNextGap(schedules, "charge", "v1");
        expect(result).toEqual({ startTime: "00:00", endTime: "06:00" });
      });
    });

    describe("gap capping", () => {
      it("caps the suggested gap at 6 hours", () => {
        const schedules = [makeCharge("v1", "10:00", "12:00")];
        const result = findNextGap(schedules, "charge", "v1");
        // Largest gap is 12:00-10:00 (22 hours), should be capped at 6h
        const startSlot = timeToSlot(result.startTime);
        const endSlot = timeToSlot(result.endTime);
        const length = endSlot > startSlot
          ? endSlot - startSlot
          : SLOTS - startSlot + endSlot;
        expect(length).toBe(24); // 6 hours = 24 quarter-hour slots
      });
    });
  });
});
