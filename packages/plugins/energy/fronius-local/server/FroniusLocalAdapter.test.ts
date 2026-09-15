import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  FroniusConnectionError,
  FroniusLocalAdapter,
  FroniusParseError,
} from "./FroniusLocalAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import {
  type FroniusFetchStub,
  installFroniusFetchStub,
} from "./test-helpers/froniusFetchHarness.ts";

describe("FroniusLocalAdapter", () => {
  const testLogger = new Logger("Fronius", "error");
  const makeAdapter = () =>
    new FroniusLocalAdapter("192.168.1.100", 0, testLogger);

  let stub: FroniusFetchStub;

  beforeEach(() => {
    stub = installFroniusFetchStub({ matchBy: "pathContains" });
  });

  afterEach(() => {
    stub.restore();
  });

  describe("pollIntervalSeconds", () => {
    it("is 10 seconds", () => {
      expect(makeAdapter().pollIntervalSeconds()).toBe(10);
    });
  });

  describe("connect", () => {
    it("succeeds when Fronius is reachable", async () => {
      await makeAdapter().connect();
      expect(stub.fetchCalls).toHaveLength(1);
      expect(stub.fetchCalls[0].url).toContain("GetPowerFlowRealtimeData");
    });

    it("throws FroniusConnectionError on non-200 response", async () => {
      stub.setResponse("GetPowerFlowRealtimeData", {
        ok: false,
        status: 500,
        json: {},
      });
      await expect(makeAdapter().connect()).rejects.toBeInstanceOf(
        FroniusConnectionError,
      );
    });

    it("throws FroniusConnectionError when fetch throws", async () => {
      globalThis.fetch = (() => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch;

      await expect(makeAdapter().connect()).rejects.toBeInstanceOf(
        FroniusConnectionError,
      );
    });
  });

  describe("getRealtimeData", () => {
    it("returns parsed realtime data", async () => {
      const data = await makeAdapter().getRealtimeData();
      expect(data.solarProductionW).toBe(5000);
      expect(data.gridPowerW).toBe(-2000);
      expect(data.homeConsumptionW).toBe(3000);
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
    });

    const powerFlow = (inverters: unknown, site: unknown) => ({
      ok: true,
      status: 200,
      json: { Body: { Data: { Inverters: inverters, Site: site } } },
    });

    it("reads battery SOC from the inverter object (GEN24)", async () => {
      stub.setResponse(
        "GetPowerFlowRealtimeData",
        powerFlow({ "1": { Battery_Mode: "normal", SOC: 48.8 } }, {
          P_Akku: -9217.9,
          P_Grid: -2278.8,
          P_Load: 676.8,
          P_PV: 10941.6,
        }),
      );
      const data = await makeAdapter().getRealtimeData();
      expect(data.batteryPowerW).toBe(-9217.9);
      expect(data.batterySoc).toBe(48.8);
    });

    it("averages SOC across inverters with batteries", async () => {
      stub.setResponse(
        "GetPowerFlowRealtimeData",
        powerFlow({
          "1": { Battery_Mode: "normal", SOC: 40 },
          "2": { Battery_Mode: "normal", SOC: 60 },
          "3": { Battery_Mode: "disabled", SOC: 0 },
        }, { P_Akku: -500, P_PV: 3000 }),
      );
      const data = await makeAdapter().getRealtimeData();
      expect(data.batterySoc).toBe(50);
    });

    it("ignores disabled battery SOC on GEN24 without battery", async () => {
      stub.setResponse(
        "GetPowerFlowRealtimeData",
        powerFlow({ "1": { Battery_Mode: "disabled", SOC: 0.0 } }, {
          P_Akku: null,
          P_Grid: null,
          P_Load: null,
          P_PV: 5671.9,
        }),
      );
      const data = await makeAdapter().getRealtimeData();
      expect(data.batterySoc).toBeNull();
    });

    it("throws FroniusParseError on missing Site data", async () => {
      stub.setResponse("GetPowerFlowRealtimeData", {
        ok: true,
        status: 200,
        json: { Body: { Data: {} } },
      });
      await expect(makeAdapter().getRealtimeData()).rejects.toBeInstanceOf(
        FroniusParseError,
      );
    });
  });

  describe("getDeviceInfo", () => {
    it("returns parsed device info", async () => {
      const info = await makeAdapter().getDeviceInfo();
      expect(info.id).toBe("1");
      expect(info.name).toBe("My Fronius");
      expect(info.manufacturer).toBe("Fronius");
      expect(info.model).toBe("123");
    });
  });
});
