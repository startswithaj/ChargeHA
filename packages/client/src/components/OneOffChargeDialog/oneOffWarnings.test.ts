import { describe, expect, it } from "vitest";
import type {
  BlockoutSchedule,
  ChargeSchedule,
  Schedule,
} from "@chargeha/shared";
import { resolveOneOffWindow } from "@chargeha/shared/oneOffCharge";
import { getOneOffWarnings } from "./oneOffWarnings.ts";

describe("getOneOffWarnings", () => {
  // Tuesday 2026-08-11, 14:00 UTC — the window resolves to that date
  const NOW = new Date("2026-08-11T14:00:00Z");

  const window = (startTime: string, durationMinutes: number) =>
    resolveOneOffWindow(startTime, durationMinutes, NOW, "UTC");

  const charge = (o: Partial<ChargeSchedule> = {}): ChargeSchedule => ({
    id: "charge-1",
    vehicleId: "v1",
    scheduleType: "charge",
    startTime: "08:00",
    endTime: "12:00",
    days: ["mon", "tue", "wed", "thu", "fri"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    oneOffDate: null,
    enabled: true,
    ...o,
  });

  const blockout = (o: Partial<BlockoutSchedule> = {}): BlockoutSchedule => ({
    id: "blockout-1",
    vehicleId: null,
    scheduleType: "blockout",
    startTime: "16:00",
    endTime: "21:00",
    days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    enabled: true,
    ...o,
  });

  const warn = (
    {
      startTime = "23:30",
      durationMinutes = 180,
      mode = "auto" as const,
      schedules = [] as Schedule[],
      excludeId,
    }: {
      startTime?: string;
      durationMinutes?: number;
      mode?: "auto" | "stop" | "charge_now";
      schedules?: Schedule[];
      excludeId?: string;
    } = {},
  ) =>
    getOneOffWarnings({
      window: window(startTime, durationMinutes),
      startTime,
      durationMinutes,
      mode,
      schedules,
      excludeId,
    });

  it("returns nothing for an auto-mode vehicle with no clashes", () => {
    expect(warn()).toEqual([]);
  });

  describe("mode warning", () => {
    it("warns when the vehicle is stopped", () => {
      const warnings = warn({ mode: "stop" });
      expect(warnings.map((w) => w.id)).toContain("mode");
      expect(warnings[0].text).toContain("Stopped");
      expect(warnings[0].text).toContain("only run in Auto");
    });

    it("warns when the vehicle is in charge-now mode", () => {
      expect(warn({ mode: "charge_now" })[0].text).toContain("Charge Now");
    });

    it("does not warn in auto mode", () => {
      expect(warn({ mode: "auto" }).map((w) => w.id)).not.toContain("mode");
    });
  });

  describe("blockout warning", () => {
    it("warns when a blockout covers the window", () => {
      const warnings = warn({
        schedules: [blockout({ startTime: "22:00", endTime: "06:00" })],
      });
      expect(warnings.map((w) => w.id)).toEqual(["blockout"]);
      expect(warnings[0].text).toContain("Blockouts take priority");
    });

    it("warns when the blockout only overlaps the post-midnight part", () => {
      // Window 23:30–02:30; blockout 01:00–03:00 on the following (Wed) day
      const warnings = warn({
        schedules: [blockout({ startTime: "01:00", endTime: "03:00" })],
      });
      expect(warnings.map((w) => w.id)).toEqual(["blockout"]);
    });

    it("does not warn for a non-overlapping blockout", () => {
      const warnings = warn({
        schedules: [blockout({ startTime: "16:00", endTime: "21:00" })],
      });
      expect(warnings).toEqual([]);
    });

    it("does not warn for a blockout on unrelated days", () => {
      const warnings = warn({
        schedules: [
          blockout({ startTime: "22:00", endTime: "06:00", days: ["sat"] }),
        ],
      });
      expect(warnings).toEqual([]);
    });

    it("ignores disabled blockouts", () => {
      const warnings = warn({
        schedules: [
          blockout({ startTime: "22:00", endTime: "06:00", enabled: false }),
        ],
      });
      expect(warnings).toEqual([]);
    });
  });

  describe("recurring-overlap warning", () => {
    it("warns when an existing charge schedule overlaps", () => {
      const warnings = warn({
        schedules: [charge({ startTime: "22:00", endTime: "06:00" })],
      });
      expect(warnings.map((w) => w.id)).toEqual(["overlap"]);
      expect(warnings[0].text).toContain("takes precedence");
    });

    it("does not warn for a non-overlapping charge schedule", () => {
      expect(warn({ schedules: [charge()] })).toEqual([]);
    });

    it("does not warn about the pending one-off being replaced", () => {
      const pending = charge({
        id: "pending",
        startTime: "23:30",
        endTime: "02:30",
        oneOffDate: "2026-08-11",
        days: ["tue"],
      });
      expect(warn({ schedules: [pending], excludeId: "pending" })).toEqual([]);
    });

    it("does warn about another vehicle's overlapping one-off", () => {
      const other = charge({
        id: "other",
        vehicleId: "v2",
        startTime: "23:30",
        endTime: "02:30",
        oneOffDate: "2026-08-11",
        days: ["tue"],
      });
      // A one-off is not a recurring schedule, so no "overlap" warning fires
      expect(warn({ schedules: [other] })).toEqual([]);
    });

    it("ignores a one-off dated outside the window", () => {
      const stale = charge({
        id: "stale",
        startTime: "23:30",
        endTime: "02:30",
        oneOffDate: "2026-09-01",
        days: ["tue"],
      });
      expect(warn({ schedules: [stale] })).toEqual([]);
    });
  });

  it("reports mode, blockout and overlap together, in that order", () => {
    const warnings = warn({
      mode: "stop",
      schedules: [
        blockout({ startTime: "22:00", endTime: "06:00" }),
        charge({ startTime: "23:00", endTime: "01:00" }),
      ],
    });
    expect(warnings.map((w) => w.id)).toEqual(["mode", "blockout", "overlap"]);
  });
});
