import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { calculateSolarAttribution } from "./solarAttribution.ts";

describe("calculateSolarAttribution", () => {
  it("attributes fully to solar when exporting (single vehicle)", () => {
    const r = calculateSolarAttribution(3000, 3000, 4000, 1000);
    expect(r.solarW).toBe(3000);
    expect(r.gridW).toBe(0);
  });

  it("attributes fully to solar for both vehicles when exporting", () => {
    // solar 12.8kW, home 12.6kW (incl. both EVs), exporting —
    // both cars must be 100% solar, not part-grid
    const a = calculateSolarAttribution(7400, 11100, 12800, 12600);
    const b = calculateSolarAttribution(3700, 11100, 12800, 12600);
    expect(a.solarW).toBe(7400);
    expect(a.gridW).toBe(0);
    expect(b.solarW).toBe(3700);
    expect(b.gridW).toBe(0);
  });

  it("splits the solar shortfall proportionally across vehicles", () => {
    // solar 5000, home 8000 (incl. 7000W EV draw) → 4000W solar for EVs
    const a = calculateSolarAttribution(4000, 7000, 5000, 8000);
    const b = calculateSolarAttribution(3000, 7000, 5000, 8000);
    expect(a.solarW).toBeCloseTo(4000 * (4000 / 7000));
    expect(b.solarW).toBeCloseTo(4000 * (3000 / 7000));
    expect(a.solarW + a.gridW).toBe(4000);
    expect(b.solarW + b.gridW).toBe(3000);
  });

  it("caps solar at actual production when the meter under-reports EV draw", () => {
    // home 938 excludes the 7000W car draw (stale meter)
    const r = calculateSolarAttribution(7000, 7000, 114, 938);
    expect(r.solarW).toBe(114);
    expect(r.gridW).toBe(6886);
  });

  it("clamps to zero solar when consumption exceeds solar plus charge", () => {
    const r = calculateSolarAttribution(3700, 3700, 100, 5000);
    expect(r.solarW).toBe(0);
    expect(r.gridW).toBe(3700);
  });

  it("attributes everything to grid when there is no solar", () => {
    const r = calculateSolarAttribution(5000, 5000, 0, 5000);
    expect(r.solarW).toBe(0);
    expect(r.gridW).toBe(5000);
  });
});
