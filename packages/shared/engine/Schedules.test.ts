import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { isScheduleActiveNow } from "./Schedules.ts";
import type { EngineSchedule } from "./types.ts";

describe("isScheduleActiveNow", () => {
  const makeSchedule = (
    overrides: Partial<EngineSchedule> = {},
  ): EngineSchedule => ({
    id: "sched-1",
    vehicleId: "v1",
    scheduleType: "charge",
    startTime: "09:00",
    endTime: "17:00",
    days: ["mon", "tue", "wed", "thu", "fri"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
    ...overrides,
  });

  describe("without timezone (server local time)", () => {
    it("returns true when inside the schedule window", () => {
      // Wednesday 12:00 local
      const now = new Date(2025, 0, 8, 12, 0);
      expect(isScheduleActiveNow(makeSchedule(), now, "")).toBe(true);
    });

    it("returns false when outside the schedule window", () => {
      // Wednesday 18:00 local
      const now = new Date(2025, 0, 8, 18, 0);
      expect(isScheduleActiveNow(makeSchedule(), now, "")).toBe(false);
    });

    it("returns false when on a non-scheduled day", () => {
      // Saturday 12:00 local
      const now = new Date(2025, 0, 11, 12, 0);
      expect(isScheduleActiveNow(makeSchedule(), now, "")).toBe(false);
    });

    it("returns true at exactly start time", () => {
      // Wednesday 09:00 local
      const now = new Date(2025, 0, 8, 9, 0);
      expect(isScheduleActiveNow(makeSchedule(), now, "")).toBe(true);
    });

    it("returns false at exactly end time", () => {
      // Wednesday 17:00 local
      const now = new Date(2025, 0, 8, 17, 0);
      expect(isScheduleActiveNow(makeSchedule(), now, "")).toBe(false);
    });
  });

  describe("overnight schedules", () => {
    const overnight = makeSchedule({
      startTime: "22:00",
      endTime: "06:00",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    });

    it("returns true before midnight", () => {
      // Wednesday 23:00 local
      const now = new Date(2025, 0, 8, 23, 0);
      expect(isScheduleActiveNow(overnight, now, "")).toBe(true);
    });

    it("returns true after midnight", () => {
      // Thursday 03:00 local
      const now = new Date(2025, 0, 9, 3, 0);
      expect(isScheduleActiveNow(overnight, now, "")).toBe(true);
    });

    it("returns false during the day", () => {
      // Wednesday 12:00 local
      const now = new Date(2025, 0, 8, 12, 0);
      expect(isScheduleActiveNow(overnight, now, "")).toBe(false);
    });

    it("returns true at exactly start time", () => {
      const now = new Date(2025, 0, 8, 22, 0);
      expect(isScheduleActiveNow(overnight, now, "")).toBe(true);
    });

    it("returns false at exactly end time", () => {
      const now = new Date(2025, 0, 9, 6, 0);
      expect(isScheduleActiveNow(overnight, now, "")).toBe(false);
    });
  });

  describe("with timezone", () => {
    it("uses timezone-adjusted time, not server local time", () => {
      // Create a UTC date: Wednesday 2025-01-08 at 03:00 UTC
      // In America/New_York (UTC-5), this is Tuesday 22:00
      const now = new Date("2025-01-08T03:00:00Z");

      const tuesdayNight = makeSchedule({
        startTime: "21:00",
        endTime: "23:00",
        days: ["tue"],
      });

      expect(isScheduleActiveNow(tuesdayNight, now, "America/New_York"))
        .toBe(true);
    });

    it("returns false when timezone-adjusted time is outside window", () => {
      // Wednesday 2025-01-08 at 14:00 UTC
      // In America/New_York (UTC-5), this is Wednesday 09:00
      const now = new Date("2025-01-08T14:00:00Z");

      const afternoon = makeSchedule({
        startTime: "14:00",
        endTime: "17:00",
        days: ["wed"],
      });

      expect(isScheduleActiveNow(afternoon, now, "America/New_York"))
        .toBe(false);
    });

    it("handles timezone day boundary (different day in timezone)", () => {
      // Thursday 2025-01-09 at 01:00 UTC
      // In America/Los_Angeles (UTC-8), this is Wednesday 17:00
      const now = new Date("2025-01-09T01:00:00Z");

      const schedule = makeSchedule({
        startTime: "16:00",
        endTime: "18:00",
        days: ["wed"],
      });

      expect(isScheduleActiveNow(schedule, now, "America/Los_Angeles"))
        .toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles all-day schedule", () => {
      const allDay = makeSchedule({
        startTime: "00:00",
        endTime: "00:00",
      });
      // start === end, startMinutes <= endMinutes path:
      // currentMinutes >= 0 && currentMinutes < 0 → false
      const now = new Date(2025, 0, 8, 12, 0);
      expect(isScheduleActiveNow(allDay, now, "")).toBe(false);
    });

    it("handles weekend-only schedule", () => {
      const weekend = makeSchedule({
        startTime: "00:00",
        endTime: "23:59",
        days: ["sat", "sun"],
      });
      // Saturday 10:00
      const sat = new Date(2025, 0, 11, 10, 0);
      expect(isScheduleActiveNow(weekend, sat, "")).toBe(true);

      // Wednesday 10:00
      const wed = new Date(2025, 0, 8, 10, 0);
      expect(isScheduleActiveNow(weekend, wed, "")).toBe(false);
    });
  });
});
