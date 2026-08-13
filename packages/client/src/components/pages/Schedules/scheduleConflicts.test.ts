import { describe, expect, it } from "vitest";
import type { ChargeSchedule, DayOfWeek } from "@chargeha/shared";
import {
  findScheduleConflicts,
  formatDays,
  formatWindows,
  overlapWindows,
  sharedDays,
} from "./scheduleConflicts.ts";

describe("scheduleConflicts", () => {
  const ALL_DAYS: DayOfWeek[] = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ];

  const makeCharge = (o: Partial<ChargeSchedule> = {}): ChargeSchedule => ({
    id: "s1",
    vehicleId: null,
    chargerId: null,
    scheduleType: "charge",
    startTime: "00:00",
    endTime: "06:00",
    days: ALL_DAYS,
    chargeAmps: 32,
    chargeLimitPct: null,
    enabled: true,
    ...o,
  });

  const point = (o: Record<string, unknown> = {}) => ({
    id: "cp-1",
    name: "OCPP Smart Charger",
    resolvedVehicleId: "VIN1" as string | null,
    resolvedVehicleName: "Model 3" as string | null,
    ...o,
  });

  describe("overlapWindows", () => {
    it("returns the whole window when both are identical", () => {
      expect(
        overlapWindows(
          { startTime: "00:00", endTime: "06:00" },
          { startTime: "00:00", endTime: "06:00" },
        ),
      ).toEqual([{ startTime: "00:00", endTime: "06:00" }]);
    });

    it("names only the shared part of a partial overlap", () => {
      expect(
        overlapWindows(
          { startTime: "00:00", endTime: "06:00" },
          { startTime: "05:00", endTime: "08:00" },
        ),
      ).toEqual([{ startTime: "05:00", endTime: "06:00" }]);
    });

    it("returns nothing when the windows only touch at an edge", () => {
      expect(
        overlapWindows(
          { startTime: "00:00", endTime: "06:00" },
          { startTime: "06:00", endTime: "08:00" },
        ),
      ).toEqual([]);
    });

    it("returns nothing for windows that never coincide", () => {
      expect(
        overlapWindows(
          { startTime: "00:00", endTime: "06:00" },
          { startTime: "08:00", endTime: "10:00" },
        ),
      ).toEqual([]);
    });

    it("joins a midnight-crossing overlap into one window", () => {
      expect(
        overlapWindows(
          { startTime: "22:00", endTime: "06:00" },
          { startTime: "23:00", endTime: "05:00" },
        ),
      ).toEqual([{ startTime: "23:00", endTime: "05:00" }]);
    });

    it("overlaps a wrapping window with a morning one", () => {
      expect(
        overlapWindows(
          { startTime: "22:00", endTime: "06:00" },
          { startTime: "05:00", endTime: "09:00" },
        ),
      ).toEqual([{ startTime: "05:00", endTime: "06:00" }]);
    });

    it("reports both pieces when a wrapping window straddles a day window", () => {
      expect(
        overlapWindows(
          { startTime: "20:00", endTime: "08:00" },
          { startTime: "06:00", endTime: "22:00" },
        ),
      ).toEqual([
        { startTime: "06:00", endTime: "08:00" },
        { startTime: "20:00", endTime: "22:00" },
      ]);
    });

    it("treats a zero-length window as never active", () => {
      expect(
        overlapWindows(
          { startTime: "06:00", endTime: "06:00" },
          { startTime: "00:00", endTime: "23:45" },
        ),
      ).toEqual([]);
    });
  });

  describe("sharedDays and formatting", () => {
    it("returns no days for a weekday and weekend pair", () => {
      expect(sharedDays(["mon", "fri"], ["sat", "sun"])).toEqual([]);
    });

    it("keeps week order in the shared set", () => {
      expect(sharedDays(["sun", "mon"], ["mon", "sun"])).toEqual([
        "mon",
        "sun",
      ]);
    });

    it("says 'every day' for a full week", () => {
      expect(formatDays(ALL_DAYS)).toBe("every day");
    });

    it("lists the days by name otherwise", () => {
      expect(formatDays(["mon", "tue"])).toBe("Mon, Tue");
    });

    it("lists window ranges", () => {
      expect(
        formatWindows([{ startTime: "05:00", endTime: "06:00" }]),
      ).toBe("05:00–06:00");
    });
  });

  describe("findScheduleConflicts", () => {
    it("reports a full overlap between a charger and a vehicle schedule", () => {
      const conflicts = findScheduleConflicts([point()], [
        makeCharge({ id: "c", chargerId: "cp-1", chargeAmps: 32 }),
        makeCharge({ id: "v", vehicleId: "VIN1", chargeLimitPct: 80 }),
      ]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].windows).toEqual([
        { startTime: "00:00", endTime: "06:00" },
      ]);
      expect(conflicts[0].chargerAmps).toBe(32);
      expect(conflicts[0].vehicleLimitPct).toBe(80);
      expect(conflicts[0].vehicleName).toBe("Model 3");
    });

    it("names only the overlapping window for a partial overlap", () => {
      const conflicts = findScheduleConflicts([point()], [
        makeCharge({ id: "c", chargerId: "cp-1" }),
        makeCharge({
          id: "v",
          vehicleId: "VIN1",
          startTime: "05:00",
          endTime: "08:00",
        }),
      ]);

      expect(conflicts[0].windows).toEqual([
        { startTime: "05:00", endTime: "06:00" },
      ]);
    });

    it("reports nothing when the two schedules share no days", () => {
      expect(findScheduleConflicts([point()], [
        makeCharge({ id: "c", chargerId: "cp-1", days: ["mon", "tue"] }),
        makeCharge({ id: "v", vehicleId: "VIN1", days: ["sat", "sun"] }),
      ])).toEqual([]);
    });

    it("reports only the days both schedules run on", () => {
      const conflicts = findScheduleConflicts([point()], [
        makeCharge({
          id: "c",
          chargerId: "cp-1",
          days: ["mon", "tue", "sat"],
        }),
        makeCharge({ id: "v", vehicleId: "VIN1", days: ["tue", "sat"] }),
      ]);

      expect(conflicts[0].days).toEqual(["tue", "sat"]);
    });

    it("reports a midnight-crossing overlap", () => {
      const conflicts = findScheduleConflicts([point()], [
        makeCharge({
          id: "c",
          chargerId: "cp-1",
          startTime: "22:00",
          endTime: "06:00",
        }),
        makeCharge({
          id: "v",
          vehicleId: "VIN1",
          startTime: "23:00",
          endTime: "02:00",
        }),
      ]);

      expect(conflicts[0].windows).toEqual([
        { startTime: "23:00", endTime: "02:00" },
      ]);
    });

    it("ignores a disabled vehicle schedule", () => {
      expect(findScheduleConflicts([point()], [
        makeCharge({ id: "c", chargerId: "cp-1" }),
        makeCharge({ id: "v", vehicleId: "VIN1", enabled: false }),
      ])).toEqual([]);
    });

    it("ignores a disabled charger schedule", () => {
      expect(findScheduleConflicts([point()], [
        makeCharge({ id: "c", chargerId: "cp-1", enabled: false }),
        makeCharge({ id: "v", vehicleId: "VIN1" }),
      ])).toEqual([]);
    });

    it("ignores a vehicle schedule for a car this point does not resolve to", () => {
      expect(findScheduleConflicts([point({ resolvedVehicleId: "VIN2" })], [
        makeCharge({ id: "c", chargerId: "cp-1" }),
        makeCharge({ id: "v", vehicleId: "VIN1" }),
      ])).toEqual([]);
    });

    it("reports nothing when the point resolves to no vehicle", () => {
      expect(findScheduleConflicts([point({ resolvedVehicleId: null })], [
        makeCharge({ id: "c", chargerId: "cp-1" }),
        makeCharge({ id: "v", vehicleId: "VIN1" }),
      ])).toEqual([]);
    });
  });
});
