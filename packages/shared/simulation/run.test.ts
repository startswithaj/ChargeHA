import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { makeDefaultVehicleConfig } from "./types.ts";
import { runSimulation } from "./run.ts";
import { DEFAULT_SOLAR_CONFIG } from "./solar.ts";

describe("runSimulation", () => {
  // A day with plenty of clear-sky solar and no clouds/storms, so a
  // plugged-in charging point should reliably see solar-driven charging some
  // time in the day.
  const sunnyDayOptions = (
    vehicles: ReturnType<typeof makeDefaultVehicleConfig>[],
  ) => ({
    seed: 1,
    vehicles,
    waterfall: false,
    minGenKw: "1",
    graceMin: "6",
    cooldownMin: "15",
    peakSolarKw: 8,
    minExcessKw: "",
    cloudiness: 0,
    storms: 0,
    homeLoad: 500,
    sunrise: DEFAULT_SOLAR_CONFIG.sunrise,
    sunset: DEFAULT_SOLAR_CONFIG.sunset,
  });

  it("produces a sensible amps profile for a single charging point with a plugged-in car", () => {
    const vehicle = makeDefaultVehicleConfig({
      id: "V1",
      name: "EV 1",
      batteryStart: 30,
    });
    const { results } = runSimulation(sunnyDayOptions([vehicle]));

    // The car should charge for at least part of the day...
    const chargingReadings = results.filter((r) => r.vehicles[0].isCharging);
    expect(chargingReadings.length).toBeGreaterThan(0);

    // ...within the configured amps bounds whenever it's charging...
    chargingReadings.forEach((r) => {
      const amps = r.vehicles[0].chargeAmps;
      expect(amps).toBeGreaterThanOrEqual(vehicle.chargeAmpsMin);
      expect(amps).toBeLessThanOrEqual(vehicle.chargeAmpsMax);
    });

    // ...and the battery level should rise from its starting point and never
    // exceed the configured charge limit.
    const finalBattery = results[results.length - 1].vehicles[0].batteryLevel;
    expect(finalBattery).toBeGreaterThan(vehicle.batteryStart);
    expect(finalBattery).toBeLessThanOrEqual(vehicle.chargeLimit);
  });

  it("splits solar surplus across two charging points by priority when waterfall allocation is enabled", () => {
    const highPriority = makeDefaultVehicleConfig({
      id: "V1",
      name: "High Priority",
      priority: 1,
      batteryStart: 20,
      chargeAmpsMax: 32,
    });
    const lowPriority = makeDefaultVehicleConfig({
      id: "V2",
      name: "Low Priority",
      priority: 2,
      batteryStart: 20,
      chargeAmpsMax: 32,
    });

    const options = {
      ...sunnyDayOptions([highPriority, lowPriority]),
      // Enough peak solar that, once the higher-priority point is saturated
      // at its max amps, there is still surplus left over for the other.
      peakSolarKw: 14,
      waterfall: true,
    };
    const { results } = runSimulation(options);

    // Find a reading where the higher-priority point is charging at its max —
    // waterfall allocation should saturate it before the lower-priority point
    // gets anything.
    const saturatedHighPriority = results.find((r) =>
      r.vehicles[0].chargeAmps >= highPriority.chargeAmpsMax
    );
    expect(saturatedHighPriority).toBeDefined();

    // Across the whole day, the higher-priority point should draw at least as
    // much total energy as the lower-priority one — it is served first.
    const totalEnergy = (index: number) =>
      results.reduce((sum, r) => sum + r.vehicles[index].chargePowerW, 0);
    expect(totalEnergy(0)).toBeGreaterThanOrEqual(totalEnergy(1));

    // Both points should still see some charging activity across the day.
    expect(results.some((r) => r.vehicles[0].isCharging)).toBe(true);
    expect(results.some((r) => r.vehicles[1].isCharging)).toBe(true);
  });
});
