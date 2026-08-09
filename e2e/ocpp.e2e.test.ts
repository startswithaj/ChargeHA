import { expect } from "@std/expect";
import { beforeAll, describe, it } from "@std/testing/bdd";
import { restartApp, trpc, waitFor } from "./helpers.ts";
import {
  meterValuesPayload,
  ocppTrpc,
  SAP_BASIC_STATION_ID,
  SAP_STATION_ID,
  sapConfigValue,
  sapReconnect,
  vcpSend,
} from "./ocppHelpers.ts";

describe("OCPP e2e", () => {
  // ocpp-sap's station id (docker/sap-e2e/station-template.json baseName) —
  // distinct from ocpp-vcp's "vcp-test" so the two simulators, both started
  // by the "ocpp" compose profile, don't evict each other's socket in the
  // app on reconnect.
  const CP_ID = "sap-test";

  // Row-scoped procedures need the charger row id. There is no row until the
  // first setConfig call below, which creates one by passing
  // chargerRowId: null — the same "one write creates it" shape the client
  // uses. Every test shares that row: `charger.create` always creates a new
  // one now that several chargers of a type are allowed, so a fresh row here
  // would have no charge point id and could never connect.
  /** Rows are matched by charge point id, not by adapter type: the stack
   *  runs two OCPP stations now, so "the OCPP row" is ambiguous. */
  async function ocppRow(chargePointId: string = CP_ID) {
    const list = await trpc.charger.list.query();
    return list.find((c) =>
      c.chargerAdapterType === "ocpp" &&
      (JSON.parse(c.chargerConfig) as { charger_id?: string }).charger_id ===
        chargePointId
    );
  }

  async function ocppRowId(chargePointId: string = CP_ID): Promise<string> {
    const row = await ocppRow(chargePointId);
    if (!row) throw new Error(`No OCPP charger row for ${chargePointId}`);
    return row.id;
  }

  beforeAll(async () => {
    // 5s loop: the suites otherwise idle on the 30s default for most
    // of their runtime. Config is per-stack (fresh DB every run).
    await trpc.config.system.set.mutate({ controllerLoopSeconds: 5 });
    await ocppTrpc.plugin.charger.ocpp.setConfig.mutate({
      chargerRowId: null,
      values: { ocppChargerId: CP_ID },
    });
    // At stack startup there's no charger row yet, so the app 404s the
    // station's very first connect attempt. sap-test's own reconnect backoff
    // (30s) is too slow for the tests below, so force an immediate reconnect
    // now that the row exists rather than racing it. vcp doesn't need this —
    // it retries every 2s via a shell loop in docker/vcp.Dockerfile.
    await sapReconnect();
  });

  it("charger connects and reports boot info", async () => {
    const status = await waitFor(async () => {
      const s = await ocppTrpc.plugin.charger.ocpp.status.query({
        chargerRowId: await ocppRowId(),
      });
      return s.connected ? s : null;
    }, { label: "sap-test connected", timeoutMs: 60_000 });
    // chargePointVendor/chargePointModel from docker/sap-e2e/station-template.json.
    expect(status.info?.vendor).toBe("ChargeHA");
    expect(status.info?.model).toBe("ChargeHA AC7.4");
    expect(status.wsPath).toBe(`/api/charger/ocpp/${CP_ID}`);
  });

  it("test connection round-trips a call to the charger", async () => {
    const result = await ocppTrpc.plugin.charger.ocpp.testConnection.mutate({
      chargerRowId: await ocppRowId(),
    });
    expect(result.success).toBe(true);
    expect(result.success === true && result.latencyMs >= 0).toBe(true);
  });

  it("rejects a connection with an unknown charger id", async () => {
    // Direct WS attempt with a wrong id — the mount must 404 before upgrade.
    const res = await fetch(
      `${Deno.env.get("E2E_APP_URL") ?? "http://localhost:18000"}` +
        "/api/charger/ocpp/wrong-id",
      { headers: { Upgrade: "websocket" } },
    );
    await res.body?.cancel();
    expect(res.status).toBe(404);
  });

  it("charge_now starts a transaction (RemoteStart → auto StartTransaction)", async () => {
    // The row configured in beforeAll — not a fresh one. `charger.create`
    // always creates now that multiple chargers of a type are allowed, so a
    // new row here would have no charge point id and could never start.
    const charger = { id: await ocppRowId() };
    // Plug the cable in first: the vcp boots to Available (no cable) and
    // the engine rightly refuses to start charging an empty connector.
    await vcpSend("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Preparing",
    });
    await trpc.charger.setMode.mutate({ id: charger.id, mode: "charge_now" });

    // vcp auto-sends StartTransaction + StatusNotification(Charging)
    // after accepting RemoteStartTransaction (verified in vcp source).
    const state = await waitFor(async () => {
      const list = await trpc.charger.list.query();
      const s = list.find((c) => c.id === charger.id)?.state;
      return s?.isCharging ? s : null;
    }, { label: "charging after RemoteStart" });
    expect(state.status).toBe("charging");
    expect(state.statusDetail).toBe("Charging");
  });

  it("MeterValues flow into charger state", async () => {
    // Re-inject each attempt: the vcp's own periodic MeterValues race a
    // one-shot injection, so the value must be refreshed until a poll
    // lands on it.
    const state = await waitFor(async () => {
      await vcpSend("MeterValues", meterValuesPayload(7200, 1500));
      const list = await trpc.charger.list.query();
      const s = list.find((c) => c.state?.chargePowerKw === 7.2)?.state;
      return s ?? null;
    }, { label: "meter values reflected" });
    expect(state.chargerVoltage).toBe(240);
    expect(state.chargeAmps).toBeCloseTo(30, 0);
    expect(state.energyAddedKwh).toBeCloseTo(1.5, 1); // meterStart was 0
  });

  it("SuspendedEV maps to suspended with raw statusDetail", async () => {
    await vcpSend("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "SuspendedEV",
    });
    const state = await waitFor(async () => {
      const list = await trpc.charger.list.query();
      const s = list.find((c) => c.state?.status === "suspended")?.state;
      return s ?? null;
    }, { label: "suspended status" });
    expect(state.isCharging).toBe(false);
    expect(state.statusDetail).toBe("SuspendedEV");
  });

  it("Reserved maps to suspended with raw statusDetail", async () => {
    // Booked ≠ ready: Reserved must not read as "available" (STATUS_MAP).
    await vcpSend("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Reserved",
    });
    const state = await waitFor(async () => {
      const s = (await ocppRow())?.state;
      return s?.statusDetail === "Reserved" ? s : null;
    }, { label: "reserved status" });
    expect(state.status).toBe("suspended");
    expect(state.isPluggedIn).toBe(false); // Reserved = no cable
  });

  it("stop mode sends RemoteStop and the transaction ends", async () => {
    const list = await trpc.charger.list.query();
    const charger = list.find((c) =>
      c.chargerAdapterType === "ocpp" &&
      (JSON.parse(c.chargerConfig) as { charger_id?: string }).charger_id ===
        CP_ID
    );
    expect(charger).toBeTruthy();
    await trpc.charger.setMode.mutate({
      id: charger?.id ?? "",
      mode: "stop",
    });
    await vcpSend("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Finishing",
    });
    // Wait for Finishing itself — !isCharging is already true from the
    // earlier status-injection tests and would return a stale state.
    const state = await waitFor(async () => {
      const s = (await trpc.charger.list.query())
        .find((c) => c.id === charger?.id)?.state;
      return s?.status === "finishing" ? s : null;
    }, { label: "stopped" });
    expect(state.status).toBe("finishing");
  });

  it("Available maps to available with no cable", async () => {
    await vcpSend("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Available",
    });
    const state = await waitFor(async () => {
      const s = (await ocppRow())?.state;
      return s?.status === "available" ? s : null;
    }, { label: "available status" });
    expect(state.isPluggedIn).toBe(false); // Available = no cable
  });

  it("derives power for an energy-only charger (register deltas)", async () => {
    // Some budget chargers send ONLY the running-total meter. Two readings
    // a few seconds apart must yield a derived power figure (tier 2 of the
    // fallback chain). Register values start above anything earlier tests
    // sent so the delta is well-defined.
    const energyOnly = (wh: number) => ({
      connectorId: 1,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{
          value: String(wh),
          measurand: "Energy.Active.Import.Register",
          unit: "Wh",
        }],
      }],
    });
    await vcpSend("MeterValues", energyOnly(50_000));
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await vcpSend("MeterValues", energyOnly(50_010)); // +10 Wh ≈ 12 kW over 3 s
    const state = await waitFor(async () => {
      const s = (await ocppRow())?.state;
      return s?.chargePowerKw !== null && (s?.chargePowerKw ?? 0) > 0
        ? s
        : null;
    }, { label: "derived power from register deltas" });
    expect(state?.chargePowerKw ?? 0).toBeGreaterThan(0); // loose: timing-safe
  });

  it("stale MeterValues flips the charger to faulted", async () => {
    // Deterministic, in-band: shrink the meter timeout, send one reading,
    // then stop sending. State must go faulted with the stale detail.
    await ocppTrpc.plugin.charger.ocpp.setConfig.mutate({
      chargerRowId: await ocppRowId(),
      values: { ocppMeterTimeoutSeconds: "5" },
    });
    await vcpSend("MeterValues", meterValuesPayload(7200, 2000));
    const state = await waitFor(async () => {
      const s = (await ocppRow())?.state;
      return s?.status === "faulted" ? s : null;
    }, { label: "stale → faulted", timeoutMs: 30_000 });
    expect(state.statusDetail).toBe("stale (no MeterValues)");
    await ocppTrpc.plugin.charger.ocpp.setConfig.mutate({
      chargerRowId: await ocppRowId(),
      values: { ocppMeterTimeoutSeconds: "300" },
    });
  });
});

// A stock charger ships reporting only the mandatory energy register, on
// whatever sample interval its vendor chose. sap-test already reports every
// measurand ChargeHA asks for, so it can never exercise this — hence the
// second station (docker/sap-e2e/basic-station-template.json), which starts
// register-only at 60s and must be reconfigured on connect.
describe("OCPP measurand negotiation e2e", () => {
  const MEASURANDS_KEY = "MeterValuesSampledData";
  const INTERVAL_KEY = "MeterValueSampleInterval";

  // Local copies: the suite above keeps its own inside its describe, because
  // module-scope helpers are banned in test files.
  async function ocppRow(chargePointId: string) {
    const list = await trpc.charger.list.query();
    return list.find((c) =>
      c.chargerAdapterType === "ocpp" &&
      (JSON.parse(c.chargerConfig) as { charger_id?: string }).charger_id ===
        chargePointId
    );
  }

  async function ocppRowId(chargePointId: string): Promise<string> {
    const row = await ocppRow(chargePointId);
    if (!row) throw new Error(`No OCPP charger row for ${chargePointId}`);
    return row.id;
  }

  beforeAll(async () => {
    // Its own row: negotiation is skipped for a charge point with no charger
    // row, which is what keeps a pairing window from reconfiguring a charger
    // the user may then discard.
    await ocppTrpc.plugin.charger.ocpp.setConfig.mutate({
      chargerRowId: null,
      values: { ocppChargerId: SAP_BASIC_STATION_ID },
    });
    // Same reason as the sap-test row: the app 404s the station's first
    // connect because no row existed yet, and its own backoff is far slower
    // than this suite.
    await sapReconnect(SAP_BASIC_STATION_ID);
  });

  it("widens a register-only charger's measurand list", async () => {
    // The station's own config, not ours: proves the ChangeConfiguration
    // landed rather than merely being answered Accepted.
    const value = await waitFor(async () => {
      const current = await sapConfigValue(
        SAP_BASIC_STATION_ID,
        MEASURANDS_KEY,
      );
      return current?.includes("Current.Import") ? current : null;
    }, { label: "measurands negotiated", timeoutMs: 60_000 });

    expect(value).toContain("Energy.Active.Import.Register");
    expect(value).toContain("Current.Import");
    expect(value).toContain("Voltage");
    expect(value).toContain("Power.Active.Import");
  });

  it("speeds a slow sample interval up to the rate ChargeHA polls at", async () => {
    const value = await waitFor(async () => {
      const current = await sapConfigValue(SAP_BASIC_STATION_ID, INTERVAL_KEY);
      return current === "30" ? current : null;
    }, { label: "sample interval negotiated", timeoutMs: 60_000 });

    expect(value).toBe("30");
  });

  it("leaves a charger that already reports everything alone", async () => {
    // sap-test starts satisfied on both keys, so negotiation must write
    // neither — a charger the user has tuned is not ours to overwrite.
    expect(await sapConfigValue(SAP_STATION_ID, INTERVAL_KEY)).toBe("10");
    const measurands = await sapConfigValue(SAP_STATION_ID, MEASURANDS_KEY);
    expect(measurands).toContain("SoC"); // untouched: not on our wanted list
  });

  it("reports current once the charger has been reconfigured", async () => {
    // The point of the whole exercise: amps are unavailable from a
    // register-only charger, and available from a negotiated one.
    const rowId = await ocppRowId(SAP_BASIC_STATION_ID);
    await trpc.charger.setMode.mutate({ id: rowId, mode: "charge_now" });

    const state = await waitFor(async () => {
      const s = (await ocppRow(SAP_BASIC_STATION_ID))?.state;
      return s?.chargeAmps !== null && s?.chargeAmps !== undefined ? s : null;
    }, { label: "current reported after negotiation", timeoutMs: 90_000 });

    expect(state.chargeAmps).toBeGreaterThan(0);
  });
});

// OCPP is charger-initiated: nothing in the app can re-establish a socket by
// itself, so a restart leaves every charger unreachable until the charger
// dials back in. Untested, that is a silent total loss of control.
describe("OCPP reconnect after an app restart", () => {
  it("the charger dials back in and control is restored", async () => {
    const rowId = await waitFor(async () => {
      const row = (await trpc.charger.list.query()).find((c) =>
        c.chargerAdapterType === "ocpp" &&
        (JSON.parse(c.chargerConfig) as { charger_id?: string }).charger_id ===
          SAP_STATION_ID
      );
      return row?.id ?? null;
    }, { label: "sap-test row" });

    // Prove it was connected first: otherwise a pass could just mean the
    // assertion never noticed the socket going away.
    const before = await ocppTrpc.plugin.charger.ocpp.status.query({
      chargerRowId: rowId,
    });
    expect(before.connected).toBe(true);

    await restartApp();

    // No sapReconnect() here on purpose — waiting out the station's own
    // backoff is the behaviour under test. A forced reconnect would prove
    // only that the app accepts a socket, not that a charger recovers.
    const after = await waitFor(async () => {
      const s = await ocppTrpc.plugin.charger.ocpp.status.query({
        chargerRowId: rowId,
      });
      return s.connected ? s : null;
    }, { label: "charger reconnected", timeoutMs: 120_000 });
    expect(after.connected).toBe(true);

    // Reconnected is not the same as controllable: prove the app can still
    // initiate a call, which is what every command depends on.
    const test = await ocppTrpc.plugin.charger.ocpp.testConnection.mutate({
      chargerRowId: rowId,
    });
    expect(test.success).toBe(true);
  });
});
