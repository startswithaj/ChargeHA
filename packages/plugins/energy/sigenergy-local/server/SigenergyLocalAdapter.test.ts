import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SigenergyLocalAdapter } from "./SigenergyLocalAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import { FakeModbusReader } from "./test-helpers/sigenergyModbusHarness.ts";

describe("SigenergyLocalAdapter", () => {
  const PLANT = 247;
  const DEVICE = 1;

  // Register addresses (must match SigenergyLocalAdapter's private constants).
  const PLANT_GRID_POWER = 30005;
  const PLANT_ESS_SOC = 30014;
  const PLANT_PV_POWER = 30035;
  const PLANT_BATTERY_POWER = 30037;
  const DEVICE_PHASE_A_VOLTAGE = 31011;
  const DEVICE_MODEL_TYPE = 30500;
  const DEVICE_SERIAL = 30515;

  /** Seed a fully-populated, healthy hybrid system. */
  const seedHealthy = (r: FakeModbusReader): FakeModbusReader =>
    r
      .setS32(PLANT, PLANT_PV_POWER, 5000) // 5 kW PV
      .setS32(PLANT, PLANT_GRID_POWER, 2000) // +2 kW import
      .setS32(PLANT, PLANT_BATTERY_POWER, -3000) // Sigenergy <0 = discharging
      .setU16(PLANT, PLANT_ESS_SOC, 555) // 55.5 %
      .setU32(DEVICE, DEVICE_PHASE_A_VOLTAGE, 24010) // 240.1 V
      .setString(DEVICE, DEVICE_MODEL_TYPE, "SigenStor", 15)
      .setString(DEVICE, DEVICE_SERIAL, "SN123456", 10);

  const logger = new Logger("Sigenergy", "error");
  let reader: FakeModbusReader;
  const makeAdapter = () =>
    new SigenergyLocalAdapter(reader, PLANT, DEVICE, logger);

  beforeEach(() => {
    reader = seedHealthy(new FakeModbusReader());
  });

  describe("pollIntervalSeconds", () => {
    it("is 10 seconds", () => {
      expect(makeAdapter().pollIntervalSeconds()).toBe(10);
    });
  });

  describe("connect", () => {
    it("connects the reader and probes PV power", async () => {
      await makeAdapter().connect();
      expect(reader.connectCalls).toBe(1);
    });

    it("throws when the probe read fails", async () => {
      reader.failAt(PLANT, PLANT_PV_POWER);
      await expect(makeAdapter().connect()).rejects.toThrow();
    });
  });

  describe("getRealtimeData", () => {
    it("maps registers with normalised sign conventions", async () => {
      const data = await makeAdapter().getRealtimeData();
      expect(data.solarProductionW).toBe(5000);
      expect(data.gridPowerW).toBe(2000); // + import passes through
      expect(data.batteryPowerW).toBe(3000); // negated: discharge is positive
      expect(data.batterySoc).toBe(55.5);
      expect(data.gridVoltageV).toBe(240.1);
    });

    it("derives home consumption as PV + grid import + battery discharge", async () => {
      const data = await makeAdapter().getRealtimeData();
      // 5000 + 2000 + 3000
      expect(data.homeConsumptionW).toBe(10000);
    });

    it("negates a charging battery (Sigenergy >0) to ChargeHA charge-negative", async () => {
      reader.setS32(PLANT, PLANT_BATTERY_POWER, 4000); // charging
      const data = await makeAdapter().getRealtimeData();
      expect(data.batteryPowerW).toBe(-4000);
    });

    it("clamps derived home consumption at zero", async () => {
      reader
        .setS32(PLANT, PLANT_GRID_POWER, -6000) // heavy export
        .setS32(PLANT, PLANT_BATTERY_POWER, 4000); // charging
      const data = await makeAdapter().getRealtimeData();
      // 5000 + (-6000) + (-4000) = -5000 → clamped
      expect(data.homeConsumptionW).toBe(0);
    });

    it("treats failed battery/soc/voltage reads as null without failing", async () => {
      reader
        .failAt(PLANT, PLANT_BATTERY_POWER)
        .failAt(PLANT, PLANT_ESS_SOC)
        .failAt(DEVICE, DEVICE_PHASE_A_VOLTAGE);
      const data = await makeAdapter().getRealtimeData();
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
      expect(data.gridVoltageV).toBeNull();
      // battery treated as 0 in the balance: 5000 + 2000
      expect(data.homeConsumptionW).toBe(7000);
    });

    it("throws when a required register (PV) read fails", async () => {
      reader.failAt(PLANT, PLANT_PV_POWER);
      await expect(makeAdapter().getRealtimeData()).rejects.toThrow();
    });
  });

  describe("getDeviceInfo", () => {
    it("returns model and serial from device registers", async () => {
      const info = await makeAdapter().getDeviceInfo();
      expect(info.id).toBe("SN123456");
      expect(info.name).toBe("SigenStor");
      expect(info.manufacturer).toBe("Sigenergy");
      expect(info.model).toBe("SigenStor");
    });

    it("falls back to defaults when device registers are unavailable", async () => {
      reader.failAt(DEVICE, DEVICE_MODEL_TYPE).failAt(DEVICE, DEVICE_SERIAL);
      const info = await makeAdapter().getDeviceInfo();
      expect(info.id).toBe("unknown");
      expect(info.name).toBe("Sigenergy");
      expect(info.model).toBe("Unknown");
    });
  });

  describe("disconnect", () => {
    it("disconnects the reader", async () => {
      await makeAdapter().disconnect();
      expect(reader.disconnectCalls).toBe(1);
    });
  });
});
