import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import {
  aggregates,
  FakePowerwallApi,
  meter,
  NOW,
} from "./test-helpers/powerwallApi.ts";
import { Powerwall2LocalAdapter } from "./Powerwall2LocalAdapter.ts";

describe("Powerwall2LocalAdapter", () => {
  const logger = new Logger("Powerwall2LocalTest", "error");
  let api: FakePowerwallApi;

  beforeEach(() => {
    api = new FakePowerwallApi(aggregates());
  });

  const makeAdapter = (maxStalenessSeconds = 60) =>
    new Powerwall2LocalAdapter(
      api,
      maxStalenessSeconds,
      logger,
      () => NOW,
    );

  it("maps Gateway signs directly to ChargeHA conventions", async () => {
    const data = await makeAdapter().getRealtimeData();

    expect(data.solarProductionW).toBe(7_501);
    expect(data.gridPowerW).toBe(-2_000);
    expect(data.homeConsumptionW).toBe(4_000);
    expect(data.batteryPowerW).toBe(1_500);
    expect(data.batterySoc).toBeCloseTo(81.47368421052632, 10);
    expect(data.gridVoltageV).toBe(239.7);
    expect(data.lastUpdated).toBe("2026-08-31T01:00:00.000Z");
  });

  it("preserves import and battery-charging signs", async () => {
    api.aggregateResponse = aggregates({
      site: meter(3_200),
      battery: meter(-4_100),
    });

    const data = await makeAdapter().getRealtimeData();

    expect(data.gridPowerW).toBe(3_200);
    expect(data.batteryPowerW).toBe(-4_100);
  });

  it("fails closed when any meter timestamp is stale", async () => {
    api.aggregateResponse = aggregates({
      solar: meter(7_500, "2026-08-31T00:58:00.000Z"),
    });

    await expect(makeAdapter().getRealtimeData()).rejects.toThrow(
      "telemetry is stale",
    );
  });

  it("fails closed when a freshness timestamp is missing", async () => {
    api.aggregateResponse = aggregates({ solar: { instant_power: 7_500 } });

    await expect(makeAdapter().getRealtimeData()).rejects.toThrow(
      "invalid solar timestamp",
    );
  });

  it("rejects an out-of-range battery state of charge", async () => {
    api.soeResponse = { percentage: 101 };

    await expect(makeAdapter().getRealtimeData()).rejects.toThrow(
      "invalid battery state of charge",
    );
  });

  it("reports the Gateway identity and firmware", async () => {
    await expect(makeAdapter().getDeviceInfo()).resolves.toEqual({
      id: "1152100-14-E--TEST",
      name: "Tesla Powerwall 2 via Gateway (Local)",
      manufacturer: "Tesla",
      model: "26.10.0 test",
    });
  });

  it("validates telemetry during connect and clears the session on disconnect", async () => {
    const adapter = makeAdapter();

    await adapter.connect();
    await adapter.disconnect();

    expect(api.clearCalls).toBe(1);
    expect(adapter.pollIntervalSeconds()).toBe(30);
  });
});
