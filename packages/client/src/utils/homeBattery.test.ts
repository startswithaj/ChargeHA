import { describe, expect, it } from "vitest";
import {
  homeBatteryMinutesToTarget,
  type HomeBatteryState,
} from "./homeBattery.ts";

describe("homeBatteryMinutesToTarget", () => {
  /** 10 kWh battery at 60%, charging at 2 kW, target 80%.
   *  2 kWh to go at 2 kW = 1 hour. */
  const battery = (overrides: Partial<HomeBatteryState> = {}) => ({
    socPct: 60,
    targetPct: 80,
    capacityKwh: 10,
    powerW: -2000,
    ...overrides,
  });

  it("converts remaining capacity and charge rate into minutes", () => {
    expect(homeBatteryMinutesToTarget(battery())).toBe(60);
  });

  it("scales with the gap to the target", () => {
    expect(homeBatteryMinutesToTarget(battery({ socPct: 70 }))).toBe(30);
    expect(homeBatteryMinutesToTarget(battery({ targetPct: 100 }))).toBe(120);
  });

  it("scales inversely with the charge rate", () => {
    expect(homeBatteryMinutesToTarget(battery({ powerW: -4000 }))).toBe(30);
    expect(homeBatteryMinutesToTarget(battery({ powerW: -1000 }))).toBe(120);
  });

  it("handles a fractional SoC", () => {
    // 80 - 65.5 = 14.5% of 10 kWh = 1.45 kWh at 2 kW = 43.5 min
    expect(homeBatteryMinutesToTarget(battery({ socPct: 65.5 }))).toBeCloseTo(
      43.5,
    );
  });

  // Everything below would be a guess dressed as a fact, so it must be null —
  // the caller falls back to showing the plain percentages instead.
  it("gives no estimate without a capacity from the inverter", () => {
    expect(homeBatteryMinutesToTarget(battery({ capacityKwh: null })))
      .toBeNull();
    expect(homeBatteryMinutesToTarget(battery({ capacityKwh: 0 }))).toBeNull();
  });

  it("gives no estimate without an SoC or power reading", () => {
    expect(homeBatteryMinutesToTarget(battery({ socPct: null }))).toBeNull();
    expect(homeBatteryMinutesToTarget(battery({ powerW: null }))).toBeNull();
  });

  it("gives no estimate for a battery that is idle or discharging", () => {
    expect(homeBatteryMinutesToTarget(battery({ powerW: 0 }))).toBeNull();
    expect(homeBatteryMinutesToTarget(battery({ powerW: 1500 }))).toBeNull();
  });

  it("gives no estimate once the target is reached", () => {
    expect(homeBatteryMinutesToTarget(battery({ socPct: 80 }))).toBeNull();
    expect(homeBatteryMinutesToTarget(battery({ socPct: 95 }))).toBeNull();
  });
});
