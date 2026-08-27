import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { CallContext } from "@chargeha/shared";
import { OcppChargerAdapter } from "./OcppChargerAdapter.ts";
import type { OcppChargerHandle } from "./OcppCentralSystem.ts";
import type { OcppLiveData } from "./OcppTypes.ts";
import { attached, call } from "./test-helpers/ocppHarness.ts";
// setChargeAmps is the only way ChargeHA limits current on an OCPP charger:
// ChargePointMaxProfile + TxDefaultProfile always, TxProfile only while a
// transaction is live.

describe("OCPP adapter — setChargeAmps profiles", () => {
  const ctx: CallContext = { origin: "test", traceId: "trace" };

  const liveData = (
    transactionId: number | null,
    status: OcppLiveData["status"] = "Charging",
  ): OcppLiveData => ({
    connected: true,
    status,
    errorCode: "NoError",
    statusInfo: null,
    vendorErrorCode: null,
    info: null,
    transactionId,
    meterStartWh: 0,
    powerW: null,
    currentA: null,
    currentSumA: null,
    voltageV: null,
    energyRegisterWh: null,
    lastMeterValuesAt: Date.now(),
    lastUpdated: new Date().toISOString(),
  });

  const CONFIG = {
    chargerId: "row-1",
    meterTimeoutSeconds: 300,
    disconnectGraceSeconds: 120,
    maxAmps: 32,
    minAmps: 6,
    phases: 3,
  };

  // Adapter plus the profiles it pushed, so the assertions read what a
  // charger would actually receive.
  const harness = (
    transactionId: number | null,
    accept = true,
    status: OcppLiveData["status"] = "Charging",
  ) => {
    const sent: unknown[] = [];
    const startedWith: Array<number | null> = [];
    const handle: OcppChargerHandle = {
      getData: () => liveData(transactionId, status),
      remoteStart: (amps) => {
        startedWith.push(amps ?? null);
        return Promise.resolve(true);
      },
      remoteStop: () => Promise.resolve(true),
      setChargingProfiles: (profiles) => {
        sent.push(...profiles);
        return Promise.resolve(accept);
      },
      recoverConnection: () => Promise.resolve([]),
      softReset: () => Promise.resolve(true),
      ping: () => Promise.resolve({ latencyMs: 1 }),
    };
    const logger = new Logger("OcppTest", "error");
    const adapter = new OcppChargerAdapter(
      CONFIG,
      handle,
      new PluginDbLogger(() => Promise.resolve(), logger),
    );
    return { adapter, sent, startedWith };
  };

  const kindsOf = (sent: unknown[]) =>
    sent.map((entry) => {
      const p = (entry as { payload: unknown }).payload as {
        csChargingProfiles: {
          chargingProfilePurpose: string;
          chargingProfileKind: string;
          chargingSchedule: { startSchedule?: string };
        };
      };
      return {
        purpose: p.csChargingProfiles.chargingProfilePurpose,
        kind: p.csChargingProfiles.chargingProfileKind,
        anchored: p.csChargingProfiles.chargingSchedule.startSchedule !==
          undefined,
      };
    });

  // Flattens each profile to the parts the charger acts on.
  const summarise = (sent: unknown[]) =>
    sent.map((entry) => {
      const p = (entry as { payload: unknown }).payload as {
        connectorId: number;
        csChargingProfiles: {
          chargingProfilePurpose: string;
          transactionId?: number;
          chargingSchedule: {
            chargingSchedulePeriod: Array<{ limit: number }>;
          };
        };
      };
      return {
        purpose: p.csChargingProfiles.chargingProfilePurpose,
        connectorId: p.connectorId,
        transactionId: p.csChargingProfiles.transactionId ?? null,
        limit: p.csChargingProfiles.chargingSchedule
          .chargingSchedulePeriod[0].limit,
      };
    });

  it("sends TxProfile with the live transaction id alongside the two standing profiles", async () => {
    const { adapter, sent } = harness(77);

    const ok = await adapter.setChargeAmps(16, ctx);

    expect(ok).toBe(true);
    expect(summarise(sent)).toEqual([
      {
        purpose: "ChargePointMaxProfile",
        connectorId: 0,
        transactionId: null,
        limit: 16,
      },
      {
        purpose: "TxDefaultProfile",
        connectorId: 1,
        transactionId: null,
        limit: 16,
      },
      { purpose: "TxProfile", connectorId: 1, transactionId: 77, limit: 16 },
    ]);
  });

  it("omits TxProfile when no transaction is running", async () => {
    const { adapter, sent } = harness(null);

    const ok = await adapter.setChargeAmps(6, ctx);

    expect(ok).toBe(true);
    expect(summarise(sent)).toEqual([
      {
        purpose: "ChargePointMaxProfile",
        connectorId: 0,
        transactionId: null,
        limit: 6,
      },
      {
        purpose: "TxDefaultProfile",
        connectorId: 1,
        transactionId: null,
        limit: 6,
      },
    ]);
  });

  it("omits TxProfile in Finishing even with a cached transaction id — the charger must reject it there", async () => {
    const { adapter, sent } = harness(77, true, "Finishing");

    const ok = await adapter.setChargeAmps(9, ctx);

    expect(ok).toBe(true);
    expect(summarise(sent).map((p) => p.purpose)).toEqual([
      "ChargePointMaxProfile",
      "TxDefaultProfile",
    ]);
  });

  it("passes the last requested amps into remoteStart so the limit rides inside RemoteStartTransaction", async () => {
    const { adapter, startedWith } = harness(null);

    await adapter.setChargeAmps(7, ctx);
    await adapter.startCharging(ctx);

    expect(startedWith).toEqual([7]);
  });

  it("uses Relative kind for transaction profiles and anchors the Absolute max profile", async () => {
    const { adapter, sent } = harness(77);

    await adapter.setChargeAmps(16, ctx);

    expect(kindsOf(sent)).toEqual([
      { purpose: "ChargePointMaxProfile", kind: "Absolute", anchored: true },
      { purpose: "TxDefaultProfile", kind: "Relative", anchored: false },
      { purpose: "TxProfile", kind: "Relative", anchored: false },
    ]);
  });

  it("propagates a rejected profile push as false", async () => {
    const { adapter } = harness(1, false);

    expect(await adapter.setChargeAmps(10, ctx)).toBe(false);
  });
});

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
      recoverConnection: () => Promise.resolve([]),
      softReset: () => Promise.resolve(true),
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

  it("reports reconnecting, never a healthy status, during the disconnect grace window", async () => {
    const adapter = adapterFor(
      liveData({
        connected: false,
        status: "Available",
        transactionId: null,
        lastMeterValuesAt: null,
      }),
      120,
    );

    const state = await adapter.getChargerState(ctx);

    expect(state.status).toBe("reconnecting");
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
      recoverConnection: () => Promise.resolve([]),
      softReset: () => Promise.resolve(true),
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
