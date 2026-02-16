import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import type { TeslaTokenManager } from "./TeslaTokenManager.ts";
import { TeslaAdapter, TeslaApiError } from "./TeslaAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import type { CallContext } from "@chargeha/shared";
import { PluginDbLogger } from "../../../PluginDbLogger.ts";
import { MockTokenManager } from "./test-helpers/MockTokenManager.ts";

describe("TeslaAdapter", () => {
  const testLogger = new Logger("Tesla", "error");

  const c = (origin: string): CallContext => ({ origin, traceId: "test" });

  // Fake HTTP server to simulate Tesla Fleet API responses
  let server: Deno.HttpServer;
  let baseUrl: string;
  let mockTokenManager: MockTokenManager;
  let adapter: TeslaAdapter;
  let requestLog: Array<
    { method: string; url: string; body?: string; authorization: string | null }
  >;
  let responseOverrides: Map<string, { status: number; body: unknown }>;

  const VIN = "5YJ3E1EA1MF000001";

  const MOCK_VEHICLE_DATA = {
    response: {
      charge_state: {
        battery_level: 72,
        charge_limit_soc: 80,
        charging_state: "Charging",
        charge_amps: 16,
        charge_current_request_max: 32,
        charger_power: 7,
        charger_voltage: 240,
        charger_phases: 1,
        charge_energy_added: 12.5,
        minutes_to_full_charge: 45,
        charge_port_door_open: true,
      },
      vehicle_state: {
        vehicle_name: "My Model 3",
      },
      state: "online",
    },
  };

  const MOCK_VEHICLES_LIST = {
    response: [
      { vin: VIN, state: "online", display_name: "My Model 3" },
    ],
  };

  beforeEach(() => {
    requestLog = [];
    responseOverrides = new Map();

    server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.text() : undefined;
      requestLog.push({
        method: req.method,
        url: url.pathname,
        body,
        authorization: req.headers.get("Authorization"),
      });

      // Check for response overrides
      const override = responseOverrides.get(url.pathname);
      if (override) {
        return new Response(JSON.stringify(override.body), {
          status: override.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Default routes
      if (url.pathname === `/api/1/vehicles/${VIN}/vehicle_data`) {
        return Response.json(MOCK_VEHICLE_DATA);
      }
      if (url.pathname === "/api/1/vehicles") {
        return Response.json(MOCK_VEHICLES_LIST);
      }
      if (url.pathname.includes("/command/")) {
        return Response.json({ response: { result: true, reason: "" } });
      }
      if (url.pathname.includes("/wake_up")) {
        return Response.json({ response: { state: "online" } });
      }

      return new Response("Not found", { status: 404 });
    });

    const addr = server.addr as Deno.NetAddr;
    baseUrl = `http://localhost:${addr.port}`;

    mockTokenManager = new MockTokenManager();
    mockTokenManager.fleetApiBaseUrl = baseUrl;

    adapter = new TeslaAdapter(
      VIN,
      mockTokenManager as unknown as TeslaTokenManager,
      baseUrl, // proxyUrl — same mock server for commands
      testLogger,
      new PluginDbLogger(async () => {}, testLogger),
    );
  });

  afterEach(async () => {
    await server.shutdown();
  });

  describe("getChargeState", () => {
    it("maps Tesla API response to VehicleChargeState", async () => {
      const state = await adapter.getChargeState(c("test:charge-state"));

      expect(state.vehicleId).toBe(VIN);
      expect(state.batteryLevel).toBe(72);
      expect(state.chargeLimit).toBe(80);
      expect(state.isCharging).toBe(true);
      expect(state.isPluggedIn).toBe(true);
      expect(state.chargeAmps).toBe(16);
      expect(state.chargeAmpsMax).toBe(32);
      expect(state.chargeAmpsMin).toBe(5);
      expect(state.chargePowerKw).toBe(3.84);
      expect(state.chargerVoltage).toBe(240);
      expect(state.chargerPhases).toBe(1);
      expect(state.energyAddedKwh).toBe(12.5);
      expect(state.minutesToFull).toBe(45);
      expect(state.chargePortOpen).toBe(true);
      expect(state.vehicleName).toBe("My Model 3");
    });

    it("sets isCharging to false when not charging", async () => {
      responseOverrides.set(`/api/1/vehicles/${VIN}/vehicle_data`, {
        status: 200,
        body: {
          response: {
            ...MOCK_VEHICLE_DATA.response,
            charge_state: {
              ...MOCK_VEHICLE_DATA.response.charge_state,
              charging_state: "Stopped",
              charger_power: 0,
              charge_amps: 0,
            },
          },
        },
      });

      const state = await adapter.getChargeState(c("test:charge-state"));
      expect(state.isCharging).toBe(false);
      expect(state.isPluggedIn).toBe(true);
    });

    it("sets isPluggedIn to false when disconnected", async () => {
      responseOverrides.set(`/api/1/vehicles/${VIN}/vehicle_data`, {
        status: 200,
        body: {
          response: {
            ...MOCK_VEHICLE_DATA.response,
            charge_state: {
              ...MOCK_VEHICLE_DATA.response.charge_state,
              charging_state: "Disconnected",
              charger_power: 0,
              charge_amps: 0,
            },
          },
        },
      });

      const state = await adapter.getChargeState(c("test:charge-state"));
      expect(state.isCharging).toBe(false);
      expect(state.isPluggedIn).toBe(false);
    });

    it("treats Starting state as charging", async () => {
      responseOverrides.set(`/api/1/vehicles/${VIN}/vehicle_data`, {
        status: 200,
        body: {
          response: {
            ...MOCK_VEHICLE_DATA.response,
            charge_state: {
              ...MOCK_VEHICLE_DATA.response.charge_state,
              charging_state: "Starting",
              charger_power: 0,
              charge_amps: 16,
            },
          },
        },
      });

      const state = await adapter.getChargeState(c("test:charge-state"));
      expect(state.isCharging).toBe(true);
      expect(state.isPluggedIn).toBe(true);
    });

    it("sends authorization header", async () => {
      await adapter.getChargeState(c("test:charge-state"));
      const req = requestLog.find((r) => r.url.includes("vehicle_data"));
      assertExists(req);
      expect(req.authorization).toBe("Bearer mock-token");
    });

    it("throws TeslaApiError on non-200 response", async () => {
      responseOverrides.set(`/api/1/vehicles/${VIN}/vehicle_data`, {
        status: 500,
        body: { error: "internal" },
      });

      const err = await adapter.getChargeState(c("test:charge-state")).then(
        () => {
          throw new Error("should not resolve");
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(TeslaApiError);
      expect((err as TeslaApiError).statusCode).toBe(500);
    });
  });

  describe("commands", () => {
    it("startCharging sends POST to charge_start", async () => {
      const result = await adapter.startCharging(c("test:start"));
      expect(result).toBe(true);
      const req = requestLog.find((r) => r.url.includes("charge_start"));
      assertExists(req);
      expect(req.method).toBe("POST");
    });

    it("stopCharging sends POST to charge_stop", async () => {
      const result = await adapter.stopCharging(c("test:stop"));
      expect(result).toBe(true);
      const req = requestLog.find((r) => r.url.includes("charge_stop"));
      expect(req).toBeDefined();
    });

    it("setChargeAmps sends amps in body", async () => {
      const result = await adapter.setChargeAmps(24, c("test:set-amps"));
      expect(result).toBe(true);
      const req = requestLog.find((r) => r.url.includes("set_charging_amps"));
      assertExists(req);
      expect(req.body).toContain("24");
    });

    it("setChargeLimit sends percent in body", async () => {
      const result = await adapter.setChargeLimit(90, c("test:set-limit"));
      expect(result).toBe(true);
      const req = requestLog.find((r) => r.url.includes("set_charge_limit"));
      assertExists(req);
      expect(req.body).toContain("90");
    });
  });

  describe("isVehicleOnline", () => {
    it("returns true when vehicle state is online", async () => {
      const online = await adapter.isVehicleOnline(c("test"));
      expect(online).toBe(true);
    });

    it("returns false when vehicle is asleep", async () => {
      responseOverrides.set("/api/1/vehicles", {
        status: 200,
        body: {
          response: [
            { vin: VIN, state: "asleep", display_name: "My Model 3" },
          ],
        },
      });

      const online = await adapter.isVehicleOnline(c("test"));
      expect(online).toBe(false);
    });
  });

  describe("wakeVehicle", () => {
    it("skips wake POST when vehicle is already online", async () => {
      const result = await adapter.wakeVehicle(c("test:wake"));
      expect(result).toBe(true);
      const wakeReq = requestLog.find((r) => r.url.includes("wake_up"));
      expect(wakeReq).toBeUndefined();
    });

    it("sends wake_up command when vehicle is asleep", async () => {
      using fakeTime = new FakeTime();

      // Set vehicle as asleep initially
      responseOverrides.set("/api/1/vehicles", {
        status: 200,
        body: {
          response: [{ vin: VIN, state: "asleep", display_name: "My Model 3" }],
        },
      });

      // Start wake - it will see asleep, send wake POST, then poll
      const wakePromise = adapter.wakeVehicle(c("test:wake"));

      // Let the initial isVehicleOnline fetch + wake POST + response.text() complete
      await Array.from({ length: 12 }).reduce<Promise<void>>(
        (p) => p.then(() => fakeTime.tickAsync(0)),
        Promise.resolve(),
      );

      // Switch to online before advancing past the poll interval
      responseOverrides.set("/api/1/vehicles", {
        status: 200,
        body: {
          response: [{
            vin: VIN,
            state: "online",
            display_name: "My Model 3",
          }],
        },
      });

      // Advance past the 15s poll interval so the retry fires
      await fakeTime.tickAsync(15000);

      const result = await wakePromise;
      expect(result).toBe(true);
      const wakeReq = requestLog.find((r) => r.url.includes("wake_up"));
      expect(wakeReq).toBeDefined();
    });
  });

  describe("408 retry", () => {
    it("retries once on 408 and succeeds", async () => {
      using fakeTime = new FakeTime();

      // First call returns 408
      responseOverrides.set(`/api/1/vehicles/${VIN}/vehicle_data`, {
        status: 408,
        body: { error: "timeout" },
      });

      const promise = adapter.getChargeState(c("test:408-retry"));

      // Batcher debounce fires → first request (408)
      await fakeTime.tickAsync(1500);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);

      // Remove 408 override so retry gets default 200
      responseOverrides.delete(`/api/1/vehicles/${VIN}/vehicle_data`);

      // Retry delay (2s) fires → second request (200)
      await fakeTime.tickAsync(2000);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);

      const state = await promise;
      expect(state.batteryLevel).toBe(72);

      const dataReqs = requestLog.filter((r) => r.url.includes("vehicle_data"));
      expect(dataReqs.length).toBe(2);
    });

    it("throws TeslaApiError when retry also returns 408", async () => {
      using fakeTime = new FakeTime();

      responseOverrides.set(`/api/1/vehicles/${VIN}/vehicle_data`, {
        status: 408,
        body: { error: "timeout" },
      });

      // Attach catch immediately to prevent unhandled rejection
      const promise = adapter.getChargeState(c("test:408-retry-fail"))
        .then(() => {
          throw new Error("should not resolve");
        })
        .catch((err: unknown) => err);

      await fakeTime.tickAsync(1500);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(2000);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);
      await fakeTime.tickAsync(0);

      const err = await promise;
      expect(err).toBeInstanceOf(TeslaApiError);
      expect((err as TeslaApiError).statusCode).toBe(408);

      const dataReqs = requestLog.filter((r) => r.url.includes("vehicle_data"));
      expect(dataReqs.length).toBe(2);
    });
  });
});
