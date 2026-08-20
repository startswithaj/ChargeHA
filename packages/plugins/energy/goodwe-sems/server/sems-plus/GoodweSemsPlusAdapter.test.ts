import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { resetSemsPlusBackoffForTests } from "./GoodweSemsPlusAdapter.ts";
import { toEnergyDataFromFlow } from "./GoodweSemsPlusMapping.ts";
import { GoodweSemsConnectionError } from "../errors.ts";
import {
  type FetchMock,
  makeSemsPlusAdapter,
  NEW_LOGIN_PATH,
  RATE_LIMIT_MS,
  SEMS_PLUS_FLOW_PATH,
  semsCode,
  semsPlusFlowOk,
  semsPlusLoginOk,
  setupFetchMock,
} from "../test-helpers/goodweSemsHarness.ts";

describe("toEnergyDataFromFlow", () => {
  it("maps the captured day sample — kW to W, export negated", () => {
    const data = toEnergyDataFromFlow({
      status: "1",
      pSystem: 5.153,
      pAc: 5.153,
      pGrid: 3.837,
      pConsum: 1.316,
      refreshTime: "2026-08-17T10:30:02.033",
    });
    expect(data.solarProductionW).toBe(5153);
    expect(data.gridPowerW).toBe(-3837);
    expect(data.homeConsumptionW).toBe(1316);
    expect(data.batteryPowerW).toBeNull();
    expect(data.batterySoc).toBeNull();
  });

  it("maps the captured night sample — negative pGrid is import", () => {
    const data = toEnergyDataFromFlow({
      status: "0",
      pAc: 0,
      pGrid: -1.108,
      pConsum: 1.108,
    });
    expect(data.solarProductionW).toBe(0);
    expect(data.gridPowerW).toBe(1108);
    expect(data.homeConsumptionW).toBe(1108);
  });

  it("falls back from pSystem to pAc for solar", () => {
    const data = toEnergyDataFromFlow({ pAc: 2.5, pGrid: 0 });
    expect(data.solarProductionW).toBe(2500);
  });

  it("derives home consumption when pConsum is absent", () => {
    const data = toEnergyDataFromFlow({ pAc: 3, pGrid: -1.2 });
    expect(data.homeConsumptionW).toBe(4200);
  });

  it("passes battery power and soc through", () => {
    const data = toEnergyDataFromFlow({
      pAc: 1,
      pGrid: 0,
      pBat: 2.4,
      soc: 87,
    });
    expect(data.batteryPowerW).toBe(2400);
    expect(data.batterySoc).toBe(87);
  });

  it("maps refreshTime to sourceUpdatedAt via local-time parsing", () => {
    const data = toEnergyDataFromFlow({
      pAc: 1,
      pGrid: 0,
      refreshTime: "2026-08-17T10:30:02.033",
    });
    expect(data.sourceUpdatedAt).toBe(
      new Date("2026-08-17T10:30:02.033").toISOString(),
    );
  });

  it("drops an unparseable refreshTime", () => {
    const data = toEnergyDataFromFlow({ pAc: 1, refreshTime: "not-a-date" });
    expect(data.sourceUpdatedAt).toBeNull();
  });

  it("tolerates an empty payload", () => {
    const data = toEnergyDataFromFlow({});
    expect(data.solarProductionW).toBe(0);
    expect(data.gridPowerW).toBe(0);
    expect(data.homeConsumptionW).toBe(0);
  });
});

describe("GoodweSemsPlusAdapter", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetSemsPlusBackoffForTests();
    fetchMock = setupFetchMock();
    fetchMock.setPathResponse(NEW_LOGIN_PATH, semsPlusLoginOk());
    fetchMock.setPathResponse(SEMS_PLUS_FLOW_PATH, semsPlusFlowOk());
  });

  afterEach(() => {
    fetchMock.restore();
  });

  const flowRequests = () =>
    fetchMock.fetchCalls.filter((c) => c.url.includes(SEMS_PLUS_FLOW_PATH));

  it("serves realtime data from the gateway flow endpoint", async () => {
    const adapter = makeSemsPlusAdapter();

    const data = await adapter.getRealtimeData();

    expect(data.solarProductionW).toBe(5153);
    expect(data.gridPowerW).toBe(-3837);
    expect(data.homeConsumptionW).toBe(1316);
    expect(flowRequests().length).toBe(1);
    expect(flowRequests()[0].url).toContain("stationId=station-1");
  });

  it("connect validates the station and seeds the cache", async () => {
    const adapter = makeSemsPlusAdapter();

    await adapter.connect();
    fetchMock.setPathResponse(
      SEMS_PLUS_FLOW_PATH,
      semsCode("GY0429"),
    );

    // Rate limited on the first poll: the connect seed is served instead.
    const data = await adapter.getRealtimeData();
    expect(data.solarProductionW).toBe(5153);
  });

  it("reads device info from the flow payload", async () => {
    fetchMock.setPathResponse(
      SEMS_PLUS_FLOW_PATH,
      semsPlusFlowOk({ name: "Peter's Station" }),
    );
    const adapter = makeSemsPlusAdapter();

    const info = await adapter.getDeviceInfo();

    expect(info.name).toBe("Peter's Station");
    expect(info.manufacturer).toBe("GoodWe");
    expect(info.model).toBe("SEMS+");
  });

  it("surfaces a gateway failure as a connection error", async () => {
    fetchMock.setPathResponse(SEMS_PLUS_FLOW_PATH, {
      ok: false,
      status: 502,
      json: {},
    });
    const adapter = makeSemsPlusAdapter();

    await expect(adapter.getRealtimeData()).rejects.toThrow(
      GoodweSemsConnectionError,
    );
  });

  it("enters backoff on a rate limit and recovers after the window", async () => {
    const time = new FakeTime();
    try {
      const adapter = makeSemsPlusAdapter();
      const seeded = await adapter.getRealtimeData();
      expect(seeded.solarProductionW).toBe(5153);

      fetchMock.setPathResponse(SEMS_PLUS_FLOW_PATH, semsCode("GY0429"));
      const cached = await adapter.getRealtimeData();
      expect(cached.solarProductionW).toBe(5153);
      const callsAfterLimit = flowRequests().length;

      // Inside the window: no network touch.
      await adapter.getRealtimeData();
      expect(flowRequests().length).toBe(callsAfterLimit);

      time.tick(RATE_LIMIT_MS + 1000);
      fetchMock.setPathResponse(
        SEMS_PLUS_FLOW_PATH,
        semsPlusFlowOk({ pSystem: 2.0, pAc: 2.0 }),
      );
      const recovered = await adapter.getRealtimeData();
      expect(recovered.solarProductionW).toBe(2000);
    } finally {
      time.restore();
    }
  });
});
