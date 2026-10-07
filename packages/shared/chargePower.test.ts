import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildEnergyData } from "./test-factories.ts";
import {
  chargeCurrentAmps,
  chargePowerKilowatts,
  chargePowerWatts,
  resolvePhases,
  resolveVoltage,
} from "./chargePower.ts";

describe("chargePower", () => {
  describe("resolveVoltage", () => {
    it("uses the charger voltage when >= 100V", () => {
      expect(resolveVoltage(240, buildEnergyData(), 230)).toBe(240);
    });

    it("falls back to the energy grid voltage when the charger reads < 100V", () => {
      const energy = buildEnergyData({ gridVoltageV: 235 });
      expect(resolveVoltage(0, energy, 230)).toBe(235);
    });

    it("falls back to the configured voltage when energy has none", () => {
      expect(resolveVoltage(0, buildEnergyData(), 220)).toBe(220);
    });

    it("falls back to the configured voltage when energy is null", () => {
      expect(resolveVoltage(0, null, 220)).toBe(220);
    });
  });

  describe("resolvePhases", () => {
    const cases: Array<[number | null, boolean, number]> = [
      [null, false, 1],
      [null, true, 3],
      [1, true, 1],
      [2, false, 2],
      [2, true, 3],
      [3, false, 3],
    ];
    cases.forEach(([reported, switchOn, expected]) => {
      it(`reported ${reported}, three-phase switch ${switchOn} → ${expected}`, () => {
        expect(resolvePhases(reported, switchOn)).toBe(expected);
      });
    });
  });

  it("works out power from current and current from power", () => {
    expect(chargePowerWatts(13, 246, 3)).toBe(9594);
    expect(chargePowerKilowatts(13, 246, 3)).toBe(9.594);
    expect(chargeCurrentAmps(9594, 246, 3)).toBe(13);
  });
});
