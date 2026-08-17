import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { OcppChargerAdapter } from "./OcppChargerAdapter.ts";
import type { OcppChargerHandle } from "./OcppCentralSystem.ts";
import type { OcppLiveData } from "./OcppTypes.ts";
import type { CallContext } from "@chargeha/shared";

describe("OCPP command confirmation window", () => {
  const ctx: CallContext = { origin: "test", traceId: "trace" };

  const liveData = (overrides: Partial<OcppLiveData>): OcppLiveData => ({
    connected: true,
    status: "Preparing",
    errorCode: "NoError",
    statusInfo: null,
    vendorErrorCode: null,
    info: null,
    transactionId: null,
    meterStartWh: null,
    powerW: null,
    currentA: null,
    currentSumA: null,
    voltageV: null,
    energyRegisterWh: null,
    lastMeterValuesAt: null,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  });

  const harness = (initial: OcppLiveData) => {
    const logger = new Logger("OcppTest", "error");
    const box = { data: initial, startCalls: 0, stopCalls: 0 };
    const handle: OcppChargerHandle = {
      getData: () => box.data,
      remoteStart: () => {
        box.startCalls++;
        return Promise.resolve(true);
      },
      remoteStop: () => {
        box.stopCalls++;
        return Promise.resolve(true);
      },
      setChargingProfiles: () => Promise.resolve(true),
      ping: () => Promise.resolve({ latencyMs: 1 }),
    };
    const adapter = new OcppChargerAdapter(
      {
        chargerId: "row-1",
        meterTimeoutSeconds: 300,
        disconnectGraceSeconds: 120,
        maxAmps: 32,
        minAmps: 6,
        phases: 1,
      },
      handle,
      new PluginDbLogger(() => Promise.resolve(), logger),
    );
    return { adapter, box };
  };

  it("reports charging after an accepted start before the charger confirms", async () => {
    const { adapter } = harness(liveData({}));

    await adapter.startCharging(ctx);
    const state = await adapter.getChargerState(ctx);

    expect(state.isCharging).toBe(true);
  });

  it("returns to the charger's own truth once it confirms", async () => {
    const { adapter, box } = harness(liveData({}));

    await adapter.startCharging(ctx);
    box.data = liveData({ status: "Charging", transactionId: 1 });
    const state = await adapter.getChargerState(ctx);

    expect(state.isCharging).toBe(true);

    box.data = liveData({ status: "SuspendedEV", transactionId: 1 });
    const after = await adapter.getChargerState(ctx);
    expect(after.isCharging).toBe(false);
  });

  it("reports stopped after an accepted stop while the cache still says charging", async () => {
    const { adapter, box } = harness(
      liveData({ status: "Charging", transactionId: 1 }),
    );
    box.data = liveData({ status: "Charging", transactionId: 1 });

    await adapter.stopCharging(ctx);
    const state = await adapter.getChargerState(ctx);

    expect(state.isCharging).toBe(false);
  });

  it("does not report charging when the command was rejected", async () => {
    const { adapter } = harness(liveData({}));
    const rejectingHandle = adapter as unknown as {
      cs: { remoteStart: () => Promise<boolean> };
    };
    rejectingHandle.cs.remoteStart = () => Promise.resolve(false);

    await adapter.startCharging(ctx);
    const state = await adapter.getChargerState(ctx);

    expect(state.isCharging).toBe(false);
  });
});
