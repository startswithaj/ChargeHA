import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { NullEnergyAdapter } from "./NullEnergyAdapter.ts";
import { Logger } from "../lib/Logger.ts";

describe("NullEnergyAdapter", () => {
  const testLogger = new Logger("NullEnergy", "error");
  const adapter = new NullEnergyAdapter(testLogger);

  it("has 30 second poll interval", () => {
    expect(adapter.pollIntervalSeconds()).toBe(30);
  });

  it("connect resolves without error", async () => {
    await adapter.connect();
  });

  it("disconnect resolves without error", async () => {
    await adapter.disconnect();
  });

  it("returns zeroed realtime data", async () => {
    const data = await adapter.getRealtimeData();
    expect(data.solarProductionW).toBe(0);
    expect(data.gridPowerW).toBe(0);
    expect(data.homeConsumptionW).toBe(0);
    expect(data.batteryPowerW).toBeNull();
    expect(data.batterySoc).toBeNull();
  });

  it("returns placeholder device info", async () => {
    const info = await adapter.getDeviceInfo();
    expect(info.id).toBe("none");
    expect(info.name).toContain("No energy source");
    expect(info.manufacturer).toBe("");
    expect(info.model).toBe("");
  });
});
