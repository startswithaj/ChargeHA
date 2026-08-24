import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { OcppChargerAdapter } from "./OcppChargerAdapter.ts";
import type { OcppChargerHandle } from "./OcppCentralSystem.ts";
import type { OcppLiveData } from "./OcppTypes.ts";
import { attached, call } from "./test-helpers/ocppHarness.ts";
import type { CallContext } from "@chargeha/shared";

describe("OCPP meter staleness", () => {
  const ctx: CallContext = { origin: "test", traceId: "trace" };

  const STALE_AGE_MS = 600_000;

  const liveData = (overrides: Partial<OcppLiveData>): OcppLiveData => ({
    connected: true,
    status: "Charging",
    errorCode: "NoError",
    statusInfo: null,
    vendorErrorCode: null,
    info: null,
    transactionId: 1,
    meterStartWh: 0,
    powerW: null,
    currentA: null,
    currentSumA: null,
    voltageV: null,
    energyRegisterWh: null,
    lastMeterValuesAt: Date.now(),
    lastUpdated: new Date().toISOString(),
    ...overrides,
  });

  const adapterFor = (data: OcppLiveData, disconnectGraceSeconds = 0) => {
    const logger = new Logger("OcppTest", "error");
    const handle: OcppChargerHandle = {
      getData: () => data,
      remoteStart: () => Promise.resolve(true),
      remoteStop: () => Promise.resolve(true),
      setChargingProfiles: () => Promise.resolve(true),
      ping: () => Promise.resolve({ latencyMs: 1 }),
    };
    return new OcppChargerAdapter(
      {
        chargerId: "row-1",
        meterTimeoutSeconds: 300,
        disconnectGraceSeconds,
        maxAmps: 32,
        minAmps: 6,
        phases: 1,
      },
      handle,
      new PluginDbLogger(() => Promise.resolve(), logger),
    );
  };

  it("keeps the charger's own status after a stop, however old the last MeterValues", async () => {
    const adapter = adapterFor(liveData({
      status: "Finishing",
      transactionId: null,
      lastMeterValuesAt: Date.now() - STALE_AGE_MS,
    }));

    const state = await adapter.getChargerState(ctx);

    expect(state.status).toBe("finishing");
    expect(state.isCharging).toBe(false);
  });

  it("reports available, not faulted, on an idle charger with an aged meter timestamp", async () => {
    const adapter = adapterFor(liveData({
      status: "Available",
      transactionId: null,
      lastMeterValuesAt: Date.now() - STALE_AGE_MS,
    }));

    const state = await adapter.getChargerState(ctx);

    expect(state.status).toBe("available");
  });

  it("keeps the charger-reported status when MeterValues go quiet mid-transaction — staleness is detail, not a fault", async () => {
    const adapter = adapterFor(liveData({
      transactionId: 42,
      lastMeterValuesAt: Date.now() - STALE_AGE_MS,
    }));

    const state = await adapter.getChargerState(ctx);

    expect(state.status).toBe("charging");
    expect(state.statusDetail).toBe("no recent meter data");
  });

  it("reports unreachable, not faulted, when the socket is down — the charger never said Faulted", async () => {
    const adapter = adapterFor(liveData({
      connected: false,
      transactionId: null,
      lastMeterValuesAt: null,
    }));

    const state = await adapter.getChargerState(ctx);

    expect(state.status).toBe("unreachable");
    expect(state.isCharging).toBe(false);
  });

  it("only maps faulted from the charger's own Faulted status", async () => {
    const adapter = adapterFor(liveData({ status: "Faulted" }));

    expect((await adapter.getChargerState(ctx)).status).toBe("faulted");
  });

  it("rides out a socket drop within the grace window without faulting", async () => {
    const adapter = adapterFor(
      liveData({
        connected: false,
        status: null,
        transactionId: null,
        lastMeterValuesAt: null,
      }),
      120,
    );

    const state = await adapter.getChargerState(ctx);

    expect(state.status).not.toBe("faulted");
    expect(state.status).not.toBe("unreachable");
  });

  it("clears the MeterValues timestamp on StopTransaction", async () => {
    const { cs, socket } = attached("CP-1");
    await call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart: 100,
      timestamp: new Date().toISOString(),
    });
    await call(socket, "MeterValues", {
      connectorId: 1,
      transactionId: 1,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{ value: "500" }],
      }],
    });
    expect(cs.getData("CP-1").lastMeterValuesAt).not.toBe(null);

    await call(socket, "StopTransaction", {
      transactionId: 1,
      meterStop: 600,
      timestamp: new Date().toISOString(),
    });

    expect(cs.getData("CP-1").lastMeterValuesAt).toBe(null);
    expect(cs.getData("CP-1").transactionId).toBe(null);
  });
});
