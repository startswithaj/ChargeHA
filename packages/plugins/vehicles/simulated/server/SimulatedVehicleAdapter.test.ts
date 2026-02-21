import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { CallContext } from "@chargeha/shared";
import { SimulatedVehicleAdapter } from "./SimulatedVehicleAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "../../../PluginDbLogger.ts";

describe("SimulatedVehicleAdapter", () => {
  const testLogger = new Logger("SimVehicle", "error");
  const testDbLog = new PluginDbLogger(async () => {}, testLogger);

  const c = (origin: string): CallContext => ({ origin, traceId: "test" });

  const defaultConfig = {
    batteryCapacityKwh: 75,
    maxChargeRateKw: 11,
    voltage: 230,
    phases: 1,
    minAmps: 5,
    maxAmps: 32,
    initialSocPercent: 50,
    chargeLimitPercent: 80,
    vehicleName: "Test EV",
  };

  const makeAdapter = (
    overrides: Partial<typeof defaultConfig> = {},
    id = "SIM1",
  ) =>
    new SimulatedVehicleAdapter(
      id,
      { ...defaultConfig, ...overrides },
      testLogger,
      testDbLog,
    );

  let adapter: SimulatedVehicleAdapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  describe("connect / disconnect", () => {
    it("stops charging on disconnect", async () => {
      await adapter.startCharging(c("test:start"));
      await adapter.disconnect();
      const state = await adapter.getChargeState(c("test:state"));
      expect(state.isCharging).toBe(false);
    });
  });

  describe("getChargeState", () => {
    it("returns initial state", async () => {
      const state = await adapter.getChargeState(c("test:state"));
      expect(state.vehicleId).toBe("SIM1");
      expect(state.batteryLevel).toBe(50);
      expect(state.chargeLimit).toBe(80);
      expect(state.isCharging).toBe(false);
      expect(state.isPluggedIn).toBe(true);
      expect(state.isOnline).toBe(true);
      expect(state.chargeAmps).toBe(0); // Not charging
      expect(state.chargeAmpsMax).toBe(32);
      expect(state.chargeAmpsMin).toBe(5);
      expect(state.chargePowerKw).toBe(0);
      expect(state.vehicleName).toBe("Test EV");
    });
  });

  describe("startCharging", () => {
    it("starts charging successfully", async () => {
      const result = await adapter.startCharging(c("test:start"));
      expect(result).toBe(true);

      const state = await adapter.getChargeState(c("test:state"));
      expect(state.isCharging).toBe(true);
      expect(state.chargeAmps).toBeGreaterThan(0);
      expect(state.chargePowerKw).toBeGreaterThan(0);
    });

    it("fails when not plugged in", async () => {
      adapter.setPluggedIn(false);
      const result = await adapter.startCharging(c("test:start"));
      expect(result).toBe(false);
    });

    it("fails when at charge limit", async () => {
      const fullAdapter = makeAdapter(
        { initialSocPercent: 80, chargeLimitPercent: 80 },
        "SIM2",
      );
      const result = await fullAdapter.startCharging(c("test:start"));
      expect(result).toBe(false);
    });
  });

  describe("stopCharging", () => {
    it("stops charging successfully", async () => {
      await adapter.startCharging(c("test:start"));
      const result = await adapter.stopCharging(c("test:stop"));
      expect(result).toBe(true);

      const state = await adapter.getChargeState(c("test:state"));
      expect(state.isCharging).toBe(false);
      expect(state.chargePowerKw).toBe(0);
    });
  });

  describe("setChargeAmps", () => {
    const ampsCases: Array<[input: number, expected: number, label: string]> = [
      [20, 20, "within bounds"],
      [1, 5, "clamps to min"],
      [100, 32, "clamps to max"],
    ];

    ampsCases.forEach(([input, expected, label]) => {
      it(`clamps amps ${input} -> ${expected} (${label})`, async () => {
        await adapter.setChargeAmps(input, c("test:set-amps"));
        await adapter.startCharging(c("test:start"));
        const state = await adapter.getChargeState(c("test:state"));
        expect(state.chargeAmps).toBe(expected);
      });
    });
  });

  describe("setChargeLimit", () => {
    it("sets charge limit", async () => {
      await adapter.setChargeLimit(90, c("test:set-limit"));
      const state = await adapter.getChargeState(c("test:state"));
      expect(state.chargeLimit).toBe(90);
    });

    it("clamps values outside 0-100", async () => {
      await adapter.setChargeLimit(150, c("test:set-limit"));
      const high = await adapter.getChargeState(c("test:state"));
      expect(high.chargeLimit).toBe(100);

      await adapter.setChargeLimit(-10, c("test:set-limit"));
      const low = await adapter.getChargeState(c("test:state"));
      expect(low.chargeLimit).toBe(0);
    });

    it("auto-stops if SOC is already at new limit", async () => {
      const adapter2 = makeAdapter(
        { initialSocPercent: 80, chargeLimitPercent: 100 },
        "SIM3",
      );
      await adapter2.startCharging(c("test:start"));
      await adapter2.setChargeLimit(80, c("test:set-limit"));
      const state = await adapter2.getChargeState(c("test:state"));
      expect(state.isCharging).toBe(false);
    });
  });

  describe("setLocation", () => {
    it("updates the location returned via getChargeState", async () => {
      adapter.setLocation(40.7128, -74.006);
      const state = await adapter.getChargeState(c("test:state"));
      expect(state.latitude).toBe(40.7128);
      expect(state.longitude).toBe(-74.006);
    });
  });

  describe("setPluggedIn", () => {
    it("stops charging when unplugged", async () => {
      await adapter.startCharging(c("test:start"));
      adapter.setPluggedIn(false);
      const state = await adapter.getChargeState(c("test:state"));
      expect(state.isCharging).toBe(false);
      expect(state.isPluggedIn).toBe(false);
    });
  });

  describe("getCurrentPowerW", () => {
    it("returns 0 when not charging", () => {
      expect(adapter.getCurrentPowerW()).toBe(0);
    });

    it("returns positive value when charging", async () => {
      await adapter.startCharging(c("test:start"));
      expect(adapter.getCurrentPowerW()).toBeGreaterThan(0);
    });
  });

  describe("onPowerChange callback", () => {
    it("fires when charging starts", async () => {
      let lastPower = 0;
      adapter.onPowerChange = (watts) => {
        lastPower = watts;
      };

      await adapter.startCharging(c("test:start"));
      expect(lastPower).toBeGreaterThan(0);
    });

    it("fires with 0 when charging stops", async () => {
      let lastPower = -1;
      adapter.onPowerChange = (watts) => {
        lastPower = watts;
      };

      await adapter.startCharging(c("test:start"));
      await adapter.stopCharging(c("test:stop"));
      expect(lastPower).toBe(0);
    });
  });
});
