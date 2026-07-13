import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SimulatedEnergyAdapter } from "./SimulatedEnergyAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import { DEFAULT_SOLAR_CONFIG } from "@chargeha/shared/simulation";

describe("SimulatedEnergyAdapter", () => {
  const log = new Logger("SimEnergy", "error");
  const noon = new Date(2026, 5, 3, 12, 0, 0);
  const midnight = new Date(2026, 5, 3, 0, 0, 0);

  const makeAdapter = (now: () => Date) =>
    new SimulatedEnergyAdapter({ ...DEFAULT_SOLAR_CONFIG }, log, now);

  describe("pollIntervalSeconds", () => {
    it("is 10 seconds", () => {
      expect(makeAdapter(() => noon).pollIntervalSeconds()).toBe(10);
    });
  });

  describe("getDeviceInfo", () => {
    it("identifies as the ChargeHA simulator", async () => {
      const info = await makeAdapter(() => noon).getDeviceInfo();
      expect(info.manufacturer).toBe("ChargeHA");
      expect(info.id).toBe("simulated-energy");
    });
  });

  describe("getRealtimeData", () => {
    it("produces no solar at midnight, positive home and 230V grid", async () => {
      const data = await makeAdapter(() => midnight).getRealtimeData();
      expect(data.solarProductionW).toBe(0);
      expect(data.homeConsumptionW).toBeGreaterThan(0);
      expect(data.gridVoltageV).toBe(230);
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
    });

    it("produces solar during the day", async () => {
      const data = await makeAdapter(() => noon).getRealtimeData();
      expect(data.solarProductionW).toBeGreaterThan(0);
    });

    it("is deterministic for the same date and seed", async () => {
      const a = await makeAdapter(() => noon).getRealtimeData();
      const b = await makeAdapter(() => noon).getRealtimeData();
      expect(a.solarProductionW).toBe(b.solarProductionW);
      expect(a.homeConsumptionW).toBe(b.homeConsumptionW);
    });

    it("produces a different curve on a different day", async () => {
      const nextDay = new Date(2026, 5, 4, 12, 0, 0);
      const a = await makeAdapter(() => noon).getRealtimeData();
      const b = await makeAdapter(() => nextDay).getRealtimeData();
      expect(a.solarProductionW).not.toBe(b.solarProductionW);
    });
  });
});
