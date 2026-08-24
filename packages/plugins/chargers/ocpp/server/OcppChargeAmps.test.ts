// setChargeAmps is the only way ChargeHA limits current on an OCPP charger:
// ChargePointMaxProfile + TxDefaultProfile always, TxProfile only while a
// transaction is live.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { CallContext } from "@chargeha/shared";
import type { OcppChargerHandle } from "./OcppCentralSystem.ts";
import type { OcppLiveData } from "./OcppTypes.ts";
import { OcppChargerAdapter } from "./OcppChargerAdapter.ts";

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
