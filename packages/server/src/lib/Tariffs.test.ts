import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { getApplicablePeriodForTime } from "./Tariffs.ts";
import type { TariffPeriodRow } from "../db/types.ts";

describe("getApplicablePeriodForTime", () => {
  /** Helper to create a minimal TariffPeriodRow for testing. */
  const makePeriod = (
    overrides: Partial<TariffPeriodRow> & {
      startTime: string;
      endTime: string;
      ratePerKwh: number;
      days: string[];
    },
  ): TariffPeriodRow => ({
    id: 1,
    label: "Test",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("returns null when no tariff periods exist", () => {
    const result = getApplicablePeriodForTime(600, "tue", []);
    expect(result).toBeNull();
  });

  it("returns null when no periods match the time", () => {
    const periods = [
      makePeriod({
        startTime: "22:00",
        endTime: "23:59",
        ratePerKwh: 10,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      }),
    ];
    // 10:00 = 600 minutes — outside the 22:00-23:59 period
    const result = getApplicablePeriodForTime(600, "mon", periods);
    expect(result).toBeNull();
  });

  it("returns null when no periods match the day", () => {
    const periods = [
      makePeriod({
        startTime: "09:00",
        endTime: "17:00",
        ratePerKwh: 45,
        days: ["sat", "sun"],
      }),
    ];
    // Tuesday 10:00 = 600 minutes — time matches but day doesn't
    const result = getApplicablePeriodForTime(600, "tue", periods);
    expect(result).toBeNull();
  });

  it("matches a single tariff period", () => {
    const periods = [
      makePeriod({
        startTime: "07:00",
        endTime: "14:00",
        ratePerKwh: 15,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Off-peak",
      }),
    ];
    // 10:00 = 600 minutes, Tuesday
    const result = getApplicablePeriodForTime(600, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(15);
  });

  it("returns the matching period among multiple non-overlapping periods", () => {
    const periods = [
      makePeriod({
        id: 1,
        startTime: "07:00",
        endTime: "14:00",
        ratePerKwh: 15,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Off-peak",
      }),
      makePeriod({
        id: 2,
        startTime: "14:00",
        endTime: "20:00",
        ratePerKwh: 45,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Peak",
      }),
      makePeriod({
        id: 3,
        startTime: "20:00",
        endTime: "22:00",
        ratePerKwh: 30,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Shoulder",
      }),
    ];
    // 15:30 = 930 minutes → should match Peak (14:00-20:00)
    const result = getApplicablePeriodForTime(930, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(45);
  });

  it("specific days beat every-day periods when overlapping", () => {
    const periods = [
      makePeriod({
        id: 1,
        startTime: "06:00",
        endTime: "22:00",
        ratePerKwh: 30,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Standard (every day)",
      }),
      makePeriod({
        id: 2,
        startTime: "06:00",
        endTime: "22:00",
        ratePerKwh: 10,
        days: ["tue"],
        label: "Tuesday Special",
      }),
    ];
    // 12:00 = 720 minutes, Tuesday → Tuesday Special should win
    const result = getApplicablePeriodForTime(720, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(10);
  });

  it("weekday/weekend periods beat every-day periods", () => {
    const periods = [
      makePeriod({
        id: 1,
        startTime: "06:00",
        endTime: "22:00",
        ratePerKwh: 30,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Standard",
      }),
      makePeriod({
        id: 2,
        startTime: "06:00",
        endTime: "22:00",
        ratePerKwh: 20,
        days: ["mon", "tue", "wed", "thu", "fri"],
        label: "Weekday rate",
      }),
    ];
    // 12:00 = 720 minutes, Tuesday → weekday rate should win
    const result = getApplicablePeriodForTime(720, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(20);
  });

  it("specific days beat weekday/weekend periods", () => {
    const periods = [
      makePeriod({
        id: 1,
        startTime: "06:00",
        endTime: "22:00",
        ratePerKwh: 20,
        days: ["mon", "tue", "wed", "thu", "fri"],
        label: "Weekday rate",
      }),
      makePeriod({
        id: 2,
        startTime: "06:00",
        endTime: "22:00",
        ratePerKwh: 5,
        days: ["tue", "thu"],
        label: "Cheap Tue/Thu",
      }),
    ];
    // 12:00 = 720 minutes, Tuesday → specific days should win
    const result = getApplicablePeriodForTime(720, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(5);
  });

  it("specific days beat every-day, weekday, and weekend in three-way overlap", () => {
    const periods = [
      makePeriod({
        id: 1,
        startTime: "00:00",
        endTime: "23:59",
        ratePerKwh: 40,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Every day",
      }),
      makePeriod({
        id: 2,
        startTime: "00:00",
        endTime: "23:59",
        ratePerKwh: 30,
        days: ["sat", "sun"],
        label: "Weekend",
      }),
      makePeriod({
        id: 3,
        startTime: "00:00",
        endTime: "23:59",
        ratePerKwh: 10,
        days: ["sat"],
        label: "Saturday special",
      }),
    ];
    // 12:00 = 720 minutes, Saturday → Saturday special should win
    const result = getApplicablePeriodForTime(720, "sat", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(10);
  });

  it("handles exact start time boundary (inclusive)", () => {
    const periods = [
      makePeriod({
        startTime: "14:00",
        endTime: "20:00",
        ratePerKwh: 45,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      }),
    ];
    // Exactly at start time 14:00 = 840 minutes → should match
    const result = getApplicablePeriodForTime(840, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(45);
  });

  it("handles exact end time boundary (exclusive)", () => {
    const periods = [
      makePeriod({
        startTime: "14:00",
        endTime: "20:00",
        ratePerKwh: 45,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      }),
    ];
    // Exactly at end time 20:00 = 1200 minutes → should NOT match
    const result = getApplicablePeriodForTime(1200, "tue", periods);
    expect(result).toBeNull();
  });

  it("ignores disabled tariff periods", () => {
    const periods = [
      makePeriod({
        startTime: "06:00",
        endTime: "22:00",
        ratePerKwh: 10,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        enabled: false,
      }),
    ];
    // 12:00 = 720 minutes → period is disabled, should not match
    const result = getApplicablePeriodForTime(720, "tue", periods);
    expect(result).toBeNull();
  });

  it("handles weekend day correctly", () => {
    const periods = [
      makePeriod({
        startTime: "00:00",
        endTime: "23:59",
        ratePerKwh: 12,
        days: ["sat", "sun"],
        label: "Weekend",
      }),
    ];
    // 15:00 = 900 minutes, Sunday
    const result = getApplicablePeriodForTime(900, "sun", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(12);
  });

  it("handles minute-level time matching", () => {
    const periods = [
      makePeriod({
        startTime: "14:30",
        endTime: "15:30",
        ratePerKwh: 50,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      }),
    ];
    // 14:29 = 869 minutes → no match
    expect(getApplicablePeriodForTime(869, "tue", periods)).toBeNull();
    // 14:30 = 870 minutes → match (inclusive start)
    expect(getApplicablePeriodForTime(870, "tue", periods)?.ratePerKwh).toBe(
      50,
    );
    // 15:00 = 900 minutes → match
    expect(getApplicablePeriodForTime(900, "tue", periods)?.ratePerKwh).toBe(
      50,
    );
    // 15:30 = 930 minutes → no match (exclusive end)
    expect(getApplicablePeriodForTime(930, "tue", periods)).toBeNull();
  });

  // --- Overnight period tests ---

  it("overnight period 22:00-07:00 matches at 23:00", () => {
    const periods = [
      makePeriod({
        startTime: "22:00",
        endTime: "07:00",
        ratePerKwh: 8,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Off-Peak Overnight",
      }),
    ];
    // 23:00 = 1380 minutes
    const result = getApplicablePeriodForTime(1380, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(8);
  });

  it("overnight period 22:00-07:00 matches at 03:00", () => {
    const periods = [
      makePeriod({
        startTime: "22:00",
        endTime: "07:00",
        ratePerKwh: 8,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Off-Peak Overnight",
      }),
    ];
    // 03:00 = 180 minutes
    const result = getApplicablePeriodForTime(180, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(8);
  });

  it("overnight period 22:00-07:00 does NOT match at 12:00", () => {
    const periods = [
      makePeriod({
        startTime: "22:00",
        endTime: "07:00",
        ratePerKwh: 8,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Off-Peak Overnight",
      }),
    ];
    // 12:00 = 720 minutes — midday, outside overnight period
    const result = getApplicablePeriodForTime(720, "tue", periods);
    expect(result).toBeNull();
  });

  it("overnight period start boundary is inclusive — 22:00 matches", () => {
    const periods = [
      makePeriod({
        startTime: "22:00",
        endTime: "07:00",
        ratePerKwh: 8,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Off-Peak Overnight",
      }),
    ];
    // 22:00 = 1320 minutes → should match (inclusive start)
    const result = getApplicablePeriodForTime(1320, "tue", periods);
    assertExists(result);
    expect(result.ratePerKwh).toBe(8);
  });

  it("overnight period end boundary is exclusive — 07:00 does NOT match", () => {
    const periods = [
      makePeriod({
        startTime: "22:00",
        endTime: "07:00",
        ratePerKwh: 8,
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        label: "Off-Peak Overnight",
      }),
    ];
    // 07:00 = 420 minutes → should NOT match (exclusive end)
    const result = getApplicablePeriodForTime(420, "tue", periods);
    expect(result).toBeNull();
  });
});
