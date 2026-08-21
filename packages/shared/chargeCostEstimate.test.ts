import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  chargePowerKw,
  estimateChargeCost,
  resolveChargePhases,
  resolveChargeVoltage,
} from "./chargeCostEstimate.ts";
import type { TariffPeriodLike } from "./tariffs.ts";

describe("charge cost estimation", () => {
  const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  const period = (
    o: Partial<TariffPeriodLike> & {
      startTime: string;
      endTime: string;
      ratePerKwh: number;
    },
  ): TariffPeriodLike => ({
    label: "Test",
    days: ALL_DAYS,
    enabled: true,
    ...o,
  });

  // 16A × 230V × 1 phase = 3.68 kW
  const BASE = {
    amps: 16,
    volts: 230,
    phases: 1,
    startDate: "2026-08-11", // Tuesday
    defaultRatePerKwh: 0.30,
  };

  describe("chargePowerKw", () => {
    it("computes single- and three-phase power", () => {
      expect(chargePowerKw(16, 230, 1)).toBeCloseTo(3.68, 5);
      expect(chargePowerKw(16, 230, 3)).toBeCloseTo(11.04, 5);
    });
  });

  describe("resolveChargeVoltage", () => {
    const state = { chargerVoltage: 0, chargerPhases: 1, isCharging: false };

    it("trusts the vehicle reading when it's a plausible mains voltage", () => {
      expect(resolveChargeVoltage({ ...state, chargerVoltage: 241 }, 230))
        .toBe(241);
    });

    it("falls back to the measured grid voltage, then the configured one", () => {
      expect(resolveChargeVoltage(state, 230, 238)).toBe(238);
      expect(resolveChargeVoltage(state, 230)).toBe(230);
      expect(resolveChargeVoltage(state, 230, null)).toBe(230);
    });
  });

  describe("resolveChargePhases", () => {
    it("honours a live single-phase reading over the three-phase flag", () => {
      const charging = {
        chargerVoltage: 230,
        chargerPhases: 1,
        isCharging: true,
      };
      expect(resolveChargePhases(charging, true)).toBe(1);
    });

    it("uses the configured flag when not charging", () => {
      const idle = { chargerVoltage: 230, chargerPhases: 1, isCharging: false };
      expect(resolveChargePhases(idle, true)).toBe(3);
      expect(resolveChargePhases(idle, false)).toBe(1);
    });

    // Callers divide available watts by voltage * phases, so a zero here would
    // yield Infinity or NaN and slip past their "below minimum amps" guard.
    it("never returns zero phases for an idle vehicle reporting none", () => {
      const idle = { chargerVoltage: 0, chargerPhases: 0, isCharging: false };
      expect(resolveChargePhases(idle, false)).toBe(1);
      expect(resolveChargePhases(idle, true)).toBe(3);
    });

    it("still honours a live multi-phase reading over the flag being off", () => {
      const charging = {
        chargerVoltage: 400,
        chargerPhases: 3,
        isCharging: true,
      };
      expect(resolveChargePhases(charging, false)).toBe(3);
    });
  });

  describe("estimateChargeCost", () => {
    it("uses a single rate for a window inside one tariff period", () => {
      const result = estimateChargeCost({
        ...BASE,
        startTime: "23:30",
        durationMinutes: 180,
        tariffPeriods: [
          period({
            startTime: "22:00",
            endTime: "07:00",
            ratePerKwh: 0.08,
            label: "EV",
          }),
        ],
      });

      // 3.68 kW × 3h = 11.04 kWh at $0.08
      expect(result.kwh).toBeCloseTo(11.04, 5);
      expect(result.cost).toBeCloseTo(11.04 * 0.08, 5);
      expect(result.segments.length).toBe(1);
      expect(result.segments[0].label).toBe("EV");
      expect(result.segments[0].minutes).toBe(180);
    });

    it("splits the window across a tariff boundary", () => {
      const result = estimateChargeCost({
        ...BASE,
        startTime: "20:00",
        durationMinutes: 240, // 20:00–00:00
        tariffPeriods: [
          period({
            startTime: "20:00",
            endTime: "22:00",
            ratePerKwh: 0.25,
            label: "Shoulder",
          }),
          period({
            startTime: "22:00",
            endTime: "07:00",
            ratePerKwh: 0.08,
            label: "EV",
          }),
        ],
      });

      expect(result.segments.length).toBe(2);
      const byLabel = Object.fromEntries(
        result.segments.map((s) => [s.label, s]),
      );
      expect(byLabel.Shoulder.minutes).toBe(120);
      expect(byLabel.EV.minutes).toBe(120);
      // 3.68 kW × 2h = 7.36 kWh in each half
      expect(byLabel.Shoulder.cost).toBeCloseTo(7.36 * 0.25, 5);
      expect(byLabel.EV.cost).toBeCloseTo(7.36 * 0.08, 5);
      expect(result.cost).toBeCloseTo(7.36 * 0.25 + 7.36 * 0.08, 5);
    });

    it("orders segments by cost, largest first", () => {
      const result = estimateChargeCost({
        ...BASE,
        startTime: "20:00",
        durationMinutes: 240,
        tariffPeriods: [
          period({
            startTime: "20:00",
            endTime: "22:00",
            ratePerKwh: 0.25,
            label: "Shoulder",
          }),
          period({
            startTime: "22:00",
            endTime: "07:00",
            ratePerKwh: 0.08,
            label: "EV",
          }),
        ],
      });
      expect(result.segments.map((s) => s.label)).toEqual(["Shoulder", "EV"]);
    });

    it("advances the day-of-week when the window crosses midnight", () => {
      // Tuesday 23:30 + 3h → 02:30 Wednesday. A Wednesday-only cheap rate must
      // apply to the post-midnight portion.
      const result = estimateChargeCost({
        ...BASE,
        startTime: "23:30",
        durationMinutes: 180,
        tariffPeriods: [
          period({
            startTime: "22:00",
            endTime: "00:00",
            ratePerKwh: 0.40,
            label: "Tue Peak",
            days: ["tue"],
          }),
          period({
            startTime: "00:00",
            endTime: "07:00",
            ratePerKwh: 0.05,
            label: "Wed EV",
            days: ["wed"],
          }),
        ],
      });

      const byLabel = Object.fromEntries(
        result.segments.map((s) => [s.label, s]),
      );
      // 23:30–00:00 on Tuesday = 30 min; 00:00–02:30 on Wednesday = 150 min
      expect(byLabel["Tue Peak"].minutes).toBe(30);
      expect(byLabel["Wed EV"].minutes).toBe(150);
    });

    it("falls back to the default rate for uncovered minutes", () => {
      const result = estimateChargeCost({
        ...BASE,
        startTime: "10:00",
        durationMinutes: 60,
        tariffPeriods: [],
      });

      expect(result.segments.length).toBe(1);
      expect(result.segments[0].label).toBe("Default");
      expect(result.segments[0].ratePerKwh).toBe(0.30);
      expect(result.cost).toBeCloseTo(3.68 * 0.30, 5);
    });

    it("merges a split period with the same label and rate into one line", () => {
      // Shoulder either side of peak — one line, not two
      const result = estimateChargeCost({
        ...BASE,
        startTime: "15:00",
        durationMinutes: 420, // 15:00–22:00
        tariffPeriods: [
          period({
            startTime: "14:00",
            endTime: "16:00",
            ratePerKwh: 0.25,
            label: "Shoulder",
          }),
          period({
            startTime: "16:00",
            endTime: "21:00",
            ratePerKwh: 0.45,
            label: "Peak",
          }),
          period({
            startTime: "21:00",
            endTime: "23:00",
            ratePerKwh: 0.25,
            label: "Shoulder",
          }),
        ],
      });

      const shoulder = result.segments.filter((s) => s.label === "Shoulder");
      expect(shoulder.length).toBe(1);
      expect(shoulder[0].minutes).toBe(120); // 60 before peak + 60 after
    });

    it("ignores disabled tariff periods", () => {
      const result = estimateChargeCost({
        ...BASE,
        startTime: "23:30",
        durationMinutes: 60,
        tariffPeriods: [
          period({
            startTime: "22:00",
            endTime: "07:00",
            ratePerKwh: 0.08,
            label: "EV",
            enabled: false,
          }),
        ],
      });
      expect(result.segments[0].label).toBe("Default");
    });

    it("scales with amps and phases", () => {
      const single = estimateChargeCost({
        ...BASE,
        startTime: "23:30",
        durationMinutes: 60,
        tariffPeriods: [],
      });
      const three = estimateChargeCost({
        ...BASE,
        phases: 3,
        startTime: "23:30",
        durationMinutes: 60,
        tariffPeriods: [],
      });

      expect(three.kwh).toBeCloseTo(single.kwh * 3, 5);
      expect(three.cost).toBeCloseTo(single.cost * 3, 5);
      expect(three.powerKw).toBeCloseTo(11.04, 5);
    });

    it("totals segment costs exactly", () => {
      const result = estimateChargeCost({
        ...BASE,
        startTime: "20:00",
        durationMinutes: 480,
        tariffPeriods: [
          period({
            startTime: "16:00",
            endTime: "21:00",
            ratePerKwh: 0.45,
            label: "Peak",
          }),
          period({
            startTime: "21:00",
            endTime: "07:00",
            ratePerKwh: 0.08,
            label: "EV",
          }),
        ],
      });

      const summed = result.segments.reduce((n, s) => n + s.cost, 0);
      expect(result.cost).toBeCloseTo(summed, 10);
      const summedMinutes = result.segments.reduce((n, s) => n + s.minutes, 0);
      expect(summedMinutes).toBe(480);
    });
  });
});
