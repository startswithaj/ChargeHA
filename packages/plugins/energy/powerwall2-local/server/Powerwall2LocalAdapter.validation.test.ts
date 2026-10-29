import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { Powerwall2LocalAdapter } from "./Powerwall2LocalAdapter.ts";
import {
  aggregates,
  FakePowerwallApi,
  meter,
  NOW,
} from "./test-helpers/powerwallApi.ts";

describe("Powerwall2LocalAdapter validation", () => {
  const read = (overrides: Record<string, unknown>) =>
    new Powerwall2LocalAdapter(
      new FakePowerwallApi(aggregates(overrides)),
      60,
      new Logger("test", "error"),
      () => NOW,
    ).getRealtimeData();

  it("accepts exactly the age limit and rejects one millisecond beyond", async () => {
    await expect(
      read({ site: meter(100, new Date(NOW - 60_000).toISOString()) }),
    ).resolves.toMatchObject({ gridPowerW: 100 });
    await expect(
      read({ site: meter(100, new Date(NOW - 60_001).toISOString()) }),
    ).rejects.toThrow("stale");
  });

  it("tolerates five seconds of clock skew but rejects a future meter beyond it", async () => {
    await expect(
      read({ battery: meter(100, new Date(NOW + 5_000).toISOString()) }),
    ).resolves.toMatchObject({ batteryPowerW: 100 });
    await expect(
      read({ battery: meter(100, new Date(NOW + 5_001).toISOString()) }),
    ).rejects.toThrow("in the future");
  });

  it("requires every meter", async () => {
    await Promise.all(["site", "solar", "load", "battery"].map(async (name) => {
      await expect(read({ [name]: null })).rejects.toThrow(
        `missing ${name} meter`,
      );
    }));
  });

  it("rejects missing and nonfinite power on every meter", async () => {
    await Promise.all(
      ["site", "solar", "load", "battery"].flatMap((name) =>
        [undefined, NaN, Infinity, "100"].map(async (value) => {
          await expect(read({ [name]: { ...meter(0), instant_power: value } }))
            .rejects.toThrow(`invalid ${name}.instant_power`);
        })
      ),
    );
  });

  it("supports alternate meter field names and optional missing voltage", async () => {
    const site = {
      instantaneous_power: 1234,
      last_communication_time: new Date(NOW).toISOString(),
    };

    await expect(read({ site })).resolves.toMatchObject({
      gridPowerW: 1234,
      gridVoltageV: null,
    });
  });

  it("clamps small negative solar and load noise, not signed battery/grid power", async () => {
    await expect(read({ solar: meter(-1), load: meter(-1) })).resolves
      .toMatchObject({ solarProductionW: 0, homeConsumptionW: 0 });
  });
});
