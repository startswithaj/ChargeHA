import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  applyStatus,
  parseSemsValue,
  resetSemsBackoffForTests,
  toBatteryPowerW,
  toEnergyData,
  toGridPowerW,
} from "./GoodweSemsAdapter.ts";

beforeEach(() => {
  resetSemsBackoffForTests();
});
import {
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "./GoodweSemsClient.ts";
import {
  buildPowerflow,
  buildStationDetail,
  makeAdapter,
  makeFakeClient,
  MAX_STALE_MS,
  RATE_LIMIT_MS,
  rateLimitError as rateLimit,
} from "./test-helpers/goodweSemsHarness.ts";

describe("parseSemsValue", () => {
  const cases: Array<[string | number | undefined, number | null]> = [
    ["1234(W)", 1234],
    ["-1800(W)", -1800],
    ["0(W)", 0],
    ["3.5(kW)", 3500],
    ["0.5(MW)", 500_000],
    ["87(%)", 87],
    ["1234", 1234],
    [1234, 1234],
    [-1.5, -1.5],
    ["", null],
    ["   ", null],
    ["(W)", null],
    ["not-a-number", null],
    [undefined, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
  ];

  cases.forEach(([raw, expected]) => {
    it(`parses ${JSON.stringify(raw)} as ${expected}`, () => {
      expect(parseSemsValue(raw)).toBe(expected);
    });
  });
});

describe("applyStatus", () => {
  it("multiplies by -1", () => {
    expect(applyStatus(500, "-1")).toBe(-500);
  });

  it("multiplies by 0", () => {
    expect(applyStatus(500, 0)).toBe(0);
  });

  it("multiplies by 1", () => {
    expect(applyStatus(500, "1")).toBe(500);
  });

  it("passes the magnitude through for a non-numeric status", () => {
    expect(applyStatus(500, "unknown")).toBe(500);
  });

  it("passes the magnitude through for an absent status", () => {
    expect(applyStatus(500, undefined)).toBe(500);
  });
});

describe("toGridPowerW", () => {
  // SEMS sends `grid` unsigned in both directions; `loadStatus` carries the
  // direction. Both real-payload cases are pinned below, plus the case that
  // proves gridStatus is not the flag.
  it("treats loadStatus 1 as importing", () => {
    // Real capture: night, no PV, load 2337W all drawn from the grid.
    expect(
      toGridPowerW(
        buildPowerflow({ grid: "2337(W)", gridStatus: "-1", loadStatus: "1" }),
      ),
    ).toBe(2337);
  });

  it("treats loadStatus -1 as exporting", () => {
    // Real capture: pv 1536W = load 909W + grid 627W exported.
    expect(
      toGridPowerW(
        buildPowerflow({ grid: "627(W)", gridStatus: "1", loadStatus: "-1" }),
      ),
    ).toBe(-627);
  });

  it("ignores gridStatus when it disagrees with loadStatus", () => {
    // Real capture from a multi-inverter station: exporting 4176W with
    // gridStatus -1. Signing by gridStatus would report this as an import.
    expect(
      toGridPowerW(
        buildPowerflow({ grid: "4176(W)", gridStatus: "-1", loadStatus: "-1" }),
      ),
    ).toBe(-4176);
  });

  it("normalises an unexpectedly negative magnitude", () => {
    expect(
      toGridPowerW(
        buildPowerflow({ grid: "-1800(W)", loadStatus: "1" }),
      ),
    ).toBe(1800);
  });

  it("is 0 when loadStatus is absent — unknown direction must not read as export", () => {
    expect(
      toGridPowerW(buildPowerflow({ grid: "2337(W)", loadStatus: undefined })),
    ).toBe(0);
  });

  it("is 0 when loadStatus is 0", () => {
    expect(
      toGridPowerW(buildPowerflow({ grid: "2337(W)", loadStatus: "0" })),
    ).toBe(0);
  });

  it("is 0 when the grid field is absent", () => {
    expect(toGridPowerW(buildPowerflow({ grid: undefined }))).toBe(0);
  });

  it("is 0 when the grid field is unparseable", () => {
    expect(toGridPowerW(buildPowerflow({ grid: "(W)" }))).toBe(0);
  });
});

describe("toBatteryPowerW", () => {
  it("reads the misspelled `bettery` key SEMS actually sends", () => {
    // If a future tidy-up "corrects" the spelling to `battery`, this fails —
    // which is the point. SEMS ships the typo on the wire.
    const flow = buildPowerflow({ bettery: "900(W)", betteryStatus: "1" });
    expect(toBatteryPowerW(flow)).toBe(900);
  });

  it("ignores a correctly-spelled `battery` key", () => {
    const flow = buildPowerflow({ battery: "900(W)", batteryStatus: "1" });
    expect(toBatteryPowerW(flow)).toBeNull();
  });

  it("signs the magnitude by betteryStatus", () => {
    const flow = buildPowerflow({ bettery: "900(W)", betteryStatus: "-1" });
    expect(toBatteryPowerW(flow)).toBe(-900);
  });

  it("signs an already-negative magnitude by betteryStatus", () => {
    const flow = buildPowerflow({ bettery: "-900(W)", betteryStatus: "-1" });
    expect(toBatteryPowerW(flow)).toBe(-900);
  });

  it("is null on an inverter with no battery", () => {
    expect(toBatteryPowerW(buildPowerflow())).toBeNull();
  });
});

describe("toEnergyData", () => {
  it("maps a DT (no battery) payload with null battery fields", () => {
    const data = toEnergyData(buildPowerflow({
      pv: "4200(W)",
      load: "1500(W)",
      grid: "2700(W)",
      loadStatus: "-1",
    }));

    expect(data.solarProductionW).toBe(4200);
    expect(data.homeConsumptionW).toBe(1500);
    expect(data.gridPowerW).toBe(-2700);
    expect(data.batteryPowerW).toBeNull();
    expect(data.batterySoc).toBeNull();
    expect(data.gridVoltageV).toBeNull();
  });

  it("never reports negative home consumption", () => {
    const data = toEnergyData(buildPowerflow({
      load: "-1500(W)",
      loadStatus: "-1",
    }));
    expect(data.homeConsumptionW).toBe(1500);
  });

  it("defaults solar and consumption to 0 when the fields are absent", () => {
    const data = toEnergyData(buildPowerflow({ pv: undefined, load: "" }));
    expect(data.solarProductionW).toBe(0);
    expect(data.homeConsumptionW).toBe(0);
  });

  it("derives home from grid import on the night payload where load is empty", () => {
    // Overnight the inverter sleeps: pv/load/bettery arrive as empty strings
    // and only the meter reports, with grid already signed.
    const data = toEnergyData(buildPowerflow({
      pv: "",
      load: "",
      bettery: "",
      grid: "-536(W)",
      gridStatus: "1",
      loadStatus: "1",
    }));
    expect(data.solarProductionW).toBe(0);
    expect(data.gridPowerW).toBe(536);
    expect(data.homeConsumptionW).toBe(536);
  });

  it("derives home from solar plus grid when load is missing during the day", () => {
    const data = toEnergyData(buildPowerflow({
      pv: "1138(W)",
      load: "",
      grid: "2058(W)",
      loadStatus: "1",
    }));
    expect(data.homeConsumptionW).toBe(3196);
  });

  it("reads soc when the inverter has a battery", () => {
    const data = toEnergyData(buildPowerflow({
      bettery: "900(W)",
      betteryStatus: "-1",
      soc: "87",
    }));
    expect(data.batteryPowerW).toBe(-900);
    expect(data.batterySoc).toBe(87);
  });

  it("stamps lastUpdated as an ISO timestamp", () => {
    const time = new FakeTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      expect(toEnergyData(buildPowerflow()).lastUpdated).toBe(
        "2026-01-01T00:00:00.000Z",
      );
    } finally {
      time.restore();
    }
  });
});

describe("GoodweSemsAdapter", () => {
  describe("pollIntervalSeconds", () => {
    it("is 60 seconds — SEMS actively rate limits", () => {
      expect(makeAdapter(makeFakeClient()).pollIntervalSeconds()).toBe(60);
    });
  });

  describe("connect", () => {
    it("rejects a station reporting hasPowerflow: false", async () => {
      const client = makeFakeClient(
        buildStationDetail({ hasPowerflow: false, powerflow: null }),
      );

      await expect(makeAdapter(client).connect()).rejects.toBeInstanceOf(
        GoodweSemsConnectionError,
      );
    });

    it("succeeds on a station with power flow", async () => {
      const client = makeFakeClient();
      await makeAdapter(client).connect();
      expect(client.calls).toEqual(["station-1"]);
    });

    it("seeds the cache, so a rate limit on the first poll serves data", async () => {
      const client = makeFakeClient();
      const adapter = makeAdapter(client);
      await adapter.connect();

      client.setResult(rateLimit());
      const data = await adapter.getRealtimeData();

      expect(data.solarProductionW).toBe(3000);
      expect(data.gridPowerW).toBe(-1800);
    });

    it("sets the backoff when it is rate limited, blocking the next poll", async () => {
      const client = makeFakeClient(rateLimit());
      const adapter = makeAdapter(client);

      await expect(adapter.connect()).rejects.toBeInstanceOf(
        GoodweSemsRateLimitError,
      );
      expect(client.calls.length).toBe(1);

      // No cached reading exists, so the poll surfaces the outage — but it
      // must do so without issuing another request.
      await expect(adapter.getRealtimeData()).rejects.toBeInstanceOf(
        GoodweSemsConnectionError,
      );
      expect(client.calls.length).toBe(1);
    });
  });

  describe("getRealtimeData", () => {
    it("returns a live reading", async () => {
      const adapter = makeAdapter(makeFakeClient());
      const data = await adapter.getRealtimeData();
      expect(data.solarProductionW).toBe(3000);
    });

    it("throws when the response carries no power flow block", async () => {
      const client = makeFakeClient(buildStationDetail({ powerflow: null }));

      await expect(makeAdapter(client).getRealtimeData()).rejects
        .toBeInstanceOf(GoodweSemsConnectionError);
    });

    it("throws on a rate limit with no prior good reading", async () => {
      const client = makeFakeClient(rateLimit());

      await expect(makeAdapter(client).getRealtimeData()).rejects
        .toBeInstanceOf(GoodweSemsConnectionError);
    });

    it("serves last-good and issues no further requests inside the window", async () => {
      const time = new FakeTime();
      try {
        const client = makeFakeClient();
        const adapter = makeAdapter(client);
        await adapter.getRealtimeData();

        client.setResult(rateLimit());
        await adapter.getRealtimeData();
        const callsAfterRateLimit = client.calls.length;

        time.tick(60_000);
        const cached = await adapter.getRealtimeData();
        time.tick(60_000);
        await adapter.getRealtimeData();

        expect(client.calls.length).toBe(callsAfterRateLimit);
        expect(cached.solarProductionW).toBe(3000);
      } finally {
        time.restore();
      }
    });

    it("keeps the original lastUpdated on a cached reading", async () => {
      const time = new FakeTime(new Date("2026-01-01T00:00:00.000Z"));
      try {
        const client = makeFakeClient();
        const adapter = makeAdapter(client);
        const live = await adapter.getRealtimeData();

        client.setResult(rateLimit());
        await adapter.getRealtimeData();

        time.tick(120_000);
        const cached = await adapter.getRealtimeData();

        expect(live.lastUpdated).toBe("2026-01-01T00:00:00.000Z");
        // Restamping would record a backoff window as fresh readings.
        expect(cached.lastUpdated).toBe("2026-01-01T00:00:00.000Z");
      } finally {
        time.restore();
      }
    });

    it("throws rather than serving a reading older than the stale budget", async () => {
      const time = new FakeTime();
      try {
        const client = makeFakeClient();
        const adapter = makeAdapter(client);
        await adapter.getRealtimeData();

        client.setResult(rateLimit());
        await adapter.getRealtimeData();

        // Past the backoff, so a fresh attempt is made — it is rate limited
        // again, and by now the cached reading has aged out.
        time.tick(MAX_STALE_MS + 1000);

        await expect(adapter.getRealtimeData()).rejects.toBeInstanceOf(
          GoodweSemsConnectionError,
        );
      } finally {
        time.restore();
      }
    });

    it("resumes live reads once the backoff window expires", async () => {
      const time = new FakeTime();
      try {
        const client = makeFakeClient();
        const adapter = makeAdapter(client);
        await adapter.getRealtimeData();

        client.setResult(rateLimit());
        await adapter.getRealtimeData();
        const callsDuringBackoff = client.calls.length;

        client.setResult(
          buildStationDetail({ powerflow: buildPowerflow({ pv: "5000(W)" }) }),
        );
        time.tick(RATE_LIMIT_MS + 1000);
        const data = await adapter.getRealtimeData();

        expect(client.calls.length).toBe(callsDuringBackoff + 1);
        expect(data.solarProductionW).toBe(5000);
      } finally {
        time.restore();
      }
    });

    it("propagates a non-rate-limit failure", async () => {
      const client = makeFakeClient(new Error("network down"));

      await expect(makeAdapter(client).getRealtimeData()).rejects.toThrow(
        "network down",
      );
    });
  });

  describe("getDeviceInfo", () => {
    it("reports the station name and inverter model", async () => {
      const info = await makeAdapter(makeFakeClient()).getDeviceInfo();

      expect(info).toEqual({
        id: "station-1",
        name: "Test Station",
        manufacturer: "GoodWe",
        model: "GW10KAU-DT",
      });
    });

    it("falls back when SEMS reports no name or model", async () => {
      const client = makeFakeClient(
        buildStationDetail({ stationName: null, inverterModel: null }),
      );
      const info = await makeAdapter(client).getDeviceInfo();

      expect(info.name).toBe("GoodWe SEMS");
      expect(info.model).toBe("SEMS Portal");
    });

    it("is refused during a backoff window rather than calling out", async () => {
      const client = makeFakeClient(rateLimit());
      const adapter = makeAdapter(client);

      await expect(adapter.getRealtimeData()).rejects.toBeInstanceOf(
        GoodweSemsConnectionError,
      );
      const callsAfterRateLimit = client.calls.length;

      await expect(adapter.getDeviceInfo()).rejects.toBeInstanceOf(
        GoodweSemsRateLimitError,
      );
      expect(client.calls.length).toBe(callsAfterRateLimit);
    });
  });

  describe("disconnect", () => {
    it("clears the session and the cached reading", async () => {
      const client = makeFakeClient();
      const adapter = makeAdapter(client);
      await adapter.connect();
      await adapter.disconnect();

      expect(client.clearSessionCalls()).toBe(1);

      // With the cache dropped, a rate limit has nothing to serve.
      client.setResult(rateLimit());
      await expect(adapter.getRealtimeData()).rejects.toBeInstanceOf(
        GoodweSemsConnectionError,
      );
    });

    it("keeps the backoff window across disconnect", async () => {
      const time = new FakeTime(new Date("2026-01-01T00:00:00.000Z"));
      try {
        const client = makeFakeClient(rateLimit());
        const adapter = makeAdapter(client);

        await expect(adapter.getRealtimeData()).rejects.toBeInstanceOf(
          GoodweSemsConnectionError,
        );
        const callsAfterRateLimit = client.calls.length;

        await adapter.disconnect();
        client.setResult(buildStationDetail());
        // Still inside the window: lifecycle churn must not reach SEMS.
        await expect(adapter.getRealtimeData()).rejects.toBeInstanceOf(
          GoodweSemsConnectionError,
        );
        expect(client.calls.length).toBe(callsAfterRateLimit);

        time.tick(RATE_LIMIT_MS + 1000);
        const data = await adapter.getRealtimeData();
        assertExists(data.lastUpdated);
      } finally {
        time.restore();
      }
    });
  });
});
