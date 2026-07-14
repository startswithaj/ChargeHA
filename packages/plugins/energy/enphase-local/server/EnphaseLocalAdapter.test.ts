import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "../../../PluginDbLogger.ts";
import { EnphaseClient } from "./EnphaseClient.ts";
import { EnphaseLocalAdapter } from "./EnphaseLocalAdapter.ts";
import { FakeEnvoyHttp } from "./test-helpers/enphaseHttpHarness.ts";

describe("EnphaseLocalAdapter", () => {
  const logger = new Logger("EnphaseTest", "error");
  let http: FakeEnvoyHttp;
  let dbEntries: { level: string; message: string }[];
  let clock: number;

  const makeAdapter = () => {
    const client = new EnphaseClient(
      "10.0.0.7",
      { email: "", password: "", manualToken: "tok", cachedToken: "" },
      () => Promise.resolve(),
      logger,
      http,
    );
    const dbLog = new PluginDbLogger((entry) => {
      dbEntries.push({ level: entry.level, message: entry.message });
      return Promise.resolve();
    }, logger);
    return new EnphaseLocalAdapter(client, logger, dbLog, () => clock);
  };

  /** CT-metered system: 5 kW solar, 2 kW import. */
  const seedMetered = (h: FakeEnvoyHttp): FakeEnvoyHttp =>
    h
      .setJson("/ivp/meters", [
        { eid: 101, state: "enabled", measurementType: "production" },
        { eid: 102, state: "enabled", measurementType: "net-consumption" },
      ])
      .setJson("/ivp/meters/readings", [
        { eid: 101, activePower: 5000.4 },
        { eid: 102, activePower: 2000.2 },
      ]);

  beforeEach(() => {
    http = seedMetered(new FakeEnvoyHttp());
    dbEntries = [];
    clock = 0;
  });

  describe("getRealtimeData with CT meters", () => {
    it("maps production and net-consumption meters", async () => {
      const data = await makeAdapter().getRealtimeData();
      expect(data.solarProductionW).toBe(5000);
      expect(data.gridPowerW).toBe(2000);
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
      // node balance: 5000 + 2000, no battery
      expect(data.homeConsumptionW).toBe(7000);
    });

    it("includes battery discharge in the home consumption balance", async () => {
      http
        .setJson("/ivp/ensemble/power", {
          devices: [{ real_power_mw: 1500000 }, { real_power_mw: 500000 }],
        })
        .setJson("/ivp/ensemble/secctrl", { agg_soc: 72 });

      const data = await makeAdapter().getRealtimeData();
      expect(data.batteryPowerW).toBe(2000); // 2,000,000 mW discharge
      expect(data.batterySoc).toBe(72);
      expect(data.homeConsumptionW).toBe(9000); // 5000 + 2000 + 2000
    });

    it("returns null battery fields when ensemble endpoints are absent", async () => {
      const data = await makeAdapter().getRealtimeData();
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
    });

    it("stops probing ensemble endpoints after the first 404", async () => {
      const adapter = makeAdapter();
      await adapter.getRealtimeData();
      await adapter.getRealtimeData();
      const ensembleProbes = http.requests.filter((r) =>
        r.path.startsWith("/ivp/ensemble/")
      );
      expect(ensembleProbes).toHaveLength(2); // power + secctrl, first poll only
    });

    it("throws when the readings endpoint fails", async () => {
      http.setRaw("/ivp/meters/readings", "boom", 500);
      const adapter = makeAdapter();
      await expect(adapter.getRealtimeData()).rejects.toThrow("HTTP 500");
    });
  });

  describe("getRealtimeData without CT meters", () => {
    beforeEach(() => {
      http = new FakeEnvoyHttp()
        .setJson("/ivp/meters", [])
        .setJson("/api/v1/production", { wattsNow: 3210.9 });
    });

    it("falls back to /api/v1/production with grid reported as 0", async () => {
      const data = await makeAdapter().getRealtimeData();
      expect(data.solarProductionW).toBe(3211);
      expect(data.gridPowerW).toBe(0);
      expect(data.homeConsumptionW).toBe(3211);
    });

    it("ignores meters whose CTs are not enabled", async () => {
      http.setJson("/ivp/meters", [
        { eid: 101, state: "disabled", measurementType: "production" },
        { eid: 102, state: "disabled", measurementType: "net-consumption" },
      ]);
      const data = await makeAdapter().getRealtimeData();
      expect(data.solarProductionW).toBe(3211);
      expect(data.gridPowerW).toBe(0);
    });
  });

  describe("connect", () => {
    it("succeeds against a metered system", async () => {
      await makeAdapter().connect();
    });

    it("propagates auth/reachability failures", async () => {
      http.setRaw("/ivp/meters", "denied", 401);
      await expect(makeAdapter().connect()).rejects.toThrow();
    });

    it("writes a connected entry to the plugin log", async () => {
      await makeAdapter().connect();
      expect(dbEntries).toEqual([
        {
          level: "info",
          message: "Connected to Envoy at 10.0.0.7 — using CT meter readings",
        },
      ]);
    });
  });

  describe("plugin log on poll failure", () => {
    it("records the error once, then again after the re-log window", async () => {
      http.setRaw("/ivp/meters/readings", "boom", 500);
      const adapter = makeAdapter();

      clock = 0;
      await expect(adapter.getRealtimeData()).rejects.toThrow("HTTP 500");
      clock = 60_000; // inside the 5-min window — suppressed
      await expect(adapter.getRealtimeData()).rejects.toThrow("HTTP 500");
      clock = 6 * 60_000; // window elapsed — logged again
      await expect(adapter.getRealtimeData()).rejects.toThrow("HTTP 500");

      const errors = dbEntries.filter((e) => e.level === "error");
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toContain("HTTP 500");
    });

    it("resets the dedupe after a successful poll", async () => {
      const adapter = makeAdapter();
      http.setRaw("/ivp/meters/readings", "boom", 500);
      await expect(adapter.getRealtimeData()).rejects.toThrow();
      seedMetered(http);
      await adapter.getRealtimeData();
      http.setRaw("/ivp/meters/readings", "boom", 500);
      await expect(adapter.getRealtimeData()).rejects.toThrow();

      expect(dbEntries.filter((e) => e.level === "error")).toHaveLength(2);
    });
  });

  describe("getDeviceInfo", () => {
    it("parses serial and model from the /info XML", async () => {
      http.setRaw(
        "/info",
        "<envoy_info><device><sn>122233334444</sn><pn>800-00654-r08</pn></device></envoy_info>",
        200,
      );
      const info = await makeAdapter().getDeviceInfo();
      expect(info.id).toBe("122233334444");
      expect(info.model).toBe("800-00654-r08");
      expect(info.manufacturer).toBe("Enphase");
    });
  });
});
