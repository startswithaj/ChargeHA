import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { Powerwall2LocalAdapter } from "./Powerwall2LocalAdapter.ts";
import {
  aggregates,
  FakePowerwallApi,
  NOW,
} from "./test-helpers/powerwallApi.ts";

describe("Powerwall Gateway usable battery percentage", () => {
  const read = (percentage: unknown) => {
    const api = new FakePowerwallApi(aggregates());
    api.soeResponse = { percentage };
    return new Powerwall2LocalAdapter(
      api,
      60,
      new Logger("test", "error"),
      () => NOW,
    ).getRealtimeData();
  };

  it("reports zero usable capacity at or below the 5% buffer", async () => {
    const readings = await Promise.all([0, 2.5, 5].map((raw) => read(raw)));

    expect(readings.map((reading) => reading.batterySoc)).toEqual([0, 0, 0]);
  });

  it("reports 20% usable capacity for raw 24%", async () => {
    const reading = await read(24);

    expect(reading.batterySoc).toBe(20);
  });

  it("reports full usable capacity for raw 100%", async () => {
    const reading = await read(100);

    expect(reading.batterySoc).toBe(100);
  });

  it("rejects invalid raw SOC before scaling", async () => {
    await expect(read(Number.NaN)).rejects.toThrow("invalid battery");
  });
});
