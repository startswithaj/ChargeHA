import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  FroniusCloudAuthError,
  FroniusCloudConnectionError,
} from "./FroniusCloudAdapter.ts";
import {
  type FetchMock,
  flowdataResponse,
  makeAdapter,
  setupFetchMock,
} from "./test-helpers/froniusCloudHarness.ts";

describe("FroniusCloudAdapter", () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = setupFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("error classes", () => {
    const errorCases: Array<
      [new (msg: string) => Error, string]
    > = [
      [FroniusCloudConnectionError, "FroniusCloudConnectionError"],
      [FroniusCloudAuthError, "FroniusCloudAuthError"],
    ];
    errorCases.forEach(([ErrorClass, expectedName]) => {
      it(`${expectedName} sets name and message`, () => {
        const err = new ErrorClass("test");
        expect(err.name).toBe(expectedName);
        expect(err.message).toBe("test");
      });
    });
  });

  describe("pollIntervalSeconds", () => {
    it("is 30 seconds", () => {
      expect(makeAdapter().pollIntervalSeconds()).toBe(30);
    });
  });

  describe("connect", () => {
    it("calls POST /iam/jwt with email and password", async () => {
      await makeAdapter({ email: "user@example.com", password: "secret123" })
        .connect();

      const loginCall = mock.fetchCalls.find(
        (c) => c.url.includes("/iam/jwt") && c.method === "POST",
      );
      assertExists(loginCall);
      expect(loginCall.body).toContain("user@example.com");
      expect(loginCall.body).toContain("secret123");
    });

    it("throws on invalid credentials (401 response)", async () => {
      mock.setLoginResponse({
        ok: false,
        status: 401,
        json: { error: "Unauthorized" },
      });

      await expect(makeAdapter().connect()).rejects.toBeInstanceOf(
        FroniusCloudAuthError,
      );
    });

    it("throws when login returns 200 but no token", async () => {
      mock.setLoginResponse({
        ok: true,
        status: 200,
        json: { error: "something wrong" },
      });

      await expect(makeAdapter().connect()).rejects.toThrow(/no access token/);
    });
  });

  describe("ensureToken (driven through public API)", () => {
    it("refreshes token via PATCH when login token is near expiry", async () => {
      // Login returns a token expiring in 30s — under the 60s refresh margin.
      // The validate-system call inside connect() triggers the refresh.
      mock.setLoginTokenExpiresIn(30_000);
      await makeAdapter().connect();

      const refreshCall = mock.fetchCalls.find(
        (c) => c.method === "PATCH" && c.url.includes("/iam/jwt/"),
      );
      expect(refreshCall).toBeDefined();
    });

    it("falls back to re-login (POST) when refresh fails", async () => {
      mock.setLoginTokenExpiresIn(30_000);
      mock.setRefreshResponse({
        ok: false,
        status: 401,
        json: { error: "Token expired" },
      });

      await makeAdapter().connect();

      const patchCalls = mock.fetchCalls.filter((c) => c.method === "PATCH");
      const loginCalls = mock.fetchCalls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/iam/jwt"),
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
      // Initial connect login + fallback re-login after refresh failure.
      expect(loginCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("logs in when no access token exists yet", async () => {
      // Fresh adapter — never connected. A public data call must trigger login.
      const adapter = makeAdapter();
      mock.setPathResponse(
        "/pvsystems/pv-system-1/flowdata",
        flowdataResponse([]),
      );

      await adapter.getRealtimeData();

      const loginCall = mock.fetchCalls.find(
        (c) => c.method === "POST" && c.url.includes("/iam/jwt"),
      );
      expect(loginCall).toBeDefined();
    });
  });

  describe("request headers", () => {
    it("every outbound request carries auth headers", async () => {
      const adapter = makeAdapter();
      await adapter.connect();

      expect(mock.fetchCalls.length).toBeGreaterThan(0);
      mock.fetchCalls.forEach((call) => {
        expect(call.headers["AccessKeyId"]).toBe(
          "FKIAB4CDA71C0763413DA942DC756742318B",
        );
        expect(call.headers["AccessKeyValue"]).toBe(
          "67315e19-6805-479e-994d-7193ee5f6125",
        );
        const isLogin = call.method === "POST" && call.url.endsWith("/iam/jwt");
        if (!isLogin) {
          expect(call.headers["Authorization"]).toBe(
            "Bearer test-access-token",
          );
        }
      });
    });
  });

  describe("disconnect", () => {
    it("clears tokens so subsequent calls re-authenticate", async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      await adapter.disconnect();

      mock.setPathResponse(
        "/pvsystems/pv-system-1/flowdata",
        flowdataResponse([]),
      );
      mock.fetchCalls.length = 0;

      await adapter.getRealtimeData();

      const loginAfterDisconnect = mock.fetchCalls.find(
        (c) => c.method === "POST" && c.url.endsWith("/iam/jwt"),
      );
      expect(loginAfterDisconnect).toBeDefined();
    });
  });

  describe("getRealtimeData", () => {
    const fullChannels = [
      { channelName: "PowerPV", channelType: "Power", value: 3500, unit: "W" },
      {
        channelName: "PowerFeedIn",
        channelType: "Power",
        value: -200,
        unit: "W",
      },
      {
        channelName: "PowerLoad",
        channelType: "Power",
        value: -3300,
        unit: "W",
      },
      {
        channelName: "PowerBattCharge",
        channelType: "Power",
        value: 500,
        unit: "W",
      },
      { channelName: "SOC", channelType: "Percent", value: 75, unit: "%" },
    ];

    const mappingCases = [
      { field: "solarProductionW", expected: 3500 },
      { field: "gridPowerW", expected: -200 },
      { field: "homeConsumptionW", expected: 3300 }, // abs(-3300)
      { field: "batteryPowerW", expected: 500 },
      { field: "batterySoc", expected: 75 },
    ] as const;
    mappingCases.forEach(({ field, expected }) => {
      it(`maps channels → ${field} = ${expected}`, async () => {
        const adapter = makeAdapter();
        await adapter.connect();
        mock.setPathResponse(
          "/pvsystems/pv-system-1/flowdata",
          flowdataResponse(fullChannels),
        );

        const data = await adapter.getRealtimeData();
        expect(data[field]).toBe(expected);
      });
    });

    it("returns zeros when isOnline=false", async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      mock.setPathResponse(
        "/pvsystems/pv-system-1/flowdata",
        flowdataResponse([], false),
      );

      const data = await adapter.getRealtimeData();
      expect(data.solarProductionW).toBe(0);
      expect(data.gridPowerW).toBe(0);
      expect(data.homeConsumptionW).toBe(0);
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
    });

    it("handles missing channels gracefully (return 0 for missing)", async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      mock.setPathResponse(
        "/pvsystems/pv-system-1/flowdata",
        flowdataResponse([
          {
            channelName: "PowerPV",
            channelType: "Power",
            value: 1000,
            unit: "W",
          },
        ]),
      );

      const data = await adapter.getRealtimeData();
      expect(data.solarProductionW).toBe(1000);
      expect(data.gridPowerW).toBe(0);
      expect(data.homeConsumptionW).toBe(0);
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
    });

    it("handles null battery value", async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      mock.setPathResponse(
        "/pvsystems/pv-system-1/flowdata",
        flowdataResponse([
          {
            channelName: "PowerPV",
            channelType: "Power",
            value: 1000,
            unit: "W",
          },
          {
            channelName: "PowerBattCharge",
            channelType: "Power",
            value: null,
            unit: "W",
          },
        ]),
      );

      const data = await adapter.getRealtimeData();
      expect(data.batteryPowerW).toBeNull();
    });
  });

  describe("getCumulativeData", () => {
    it("returns zeros — cumulative data is built from local DB by the poller", async () => {
      const data = await makeAdapter().getCumulativeData();
      expect(data.solarProducedWh).toBe(0);
      expect(data.gridImportedWh).toBe(0);
      expect(data.gridExportedWh).toBe(0);
      expect(data.dailySolarProducedWh).toBe(0);
      expect(data.dailyGridImportWh).toBe(0);
      expect(data.dailyGridExportWh).toBe(0);
    });
  });

  describe("getDeviceInfo", () => {
    it("returns system name and inverter model", async () => {
      const adapter = makeAdapter();
      await adapter.connect();

      mock.setPathResponse("/pvsystems/pv-system-1/devices", {
        ok: true,
        status: 200,
        json: {
          devices: [
            {
              deviceType: "inverter",
              model: "Primo 5.0-1",
              name: "Inverter 1",
            },
            {
              deviceType: "meter",
              model: "Smart Meter TS 65A-3",
              name: "Meter 1",
            },
          ],
        },
      });

      const info = await adapter.getDeviceInfo();
      expect(info.id).toBe("pv-system-1");
      expect(info.name).toBe("My PV System");
      expect(info.manufacturer).toBe("Fronius");
      expect(info.model).toBe("Primo 5.0-1");
    });
  });
});
