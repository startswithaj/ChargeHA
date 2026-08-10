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
  sapTransactionStarted,
  vcpSend,
} from "./ocppHelpers.ts";

describe("OCPP e2e", () => {
  // ocpp-sap's first station id — the `baseName` in
  // devtools/sap-ocpp-simulator/config/e2e/station-templates/sap-test.station-template.json.
  // Distinct from the second station ("sap-basic") because two stations
  // sharing one id would evict each other's socket in the app on every
  // reconnect: OcppCentralSystem.attach() closes the previous socket for an
  // id when a new one arrives, which is right for a real reconnect but
  // thrashes forever between two stations both claiming the same id.
  const CP_ID = "sap-test";

  // No row exists until beforeAll's setConfig creates one with
  // chargerRowId: null — the same shape the client uses. Every test shares
  // it: `charger.create` would make a second row with no charge point id,
  // which could never connect.
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
    // now that the row exists rather than racing it.
    //
    // Only when it is not already connected. `openConnection` on a live socket
    // opens a SECOND one; the app then closes the first (attach() evicts the
    // previous socket for an id, which is right for a real reconnect), the
    // station sees that close and schedules its own 30s retry, and that timer
    // opens another duplicate — a self-sustaining 30s reconnect loop. Every
    // cycle resets the charge point to freshData(), losing transaction id,
    // status and meterStartWh, which is what made these suites flaky.
    const alreadyConnected = await ocppTrpc.plugin.charger.ocpp.status
      .query({ chargerRowId: await ocppRowId() })
      .then((s) => s.connected)
      .catch(() => false);
    if (!alreadyConnected) await sapReconnect();
  });

  it("charger connects and reports boot info", async () => {
    const status = await waitFor(async () => {
      const s = await ocppTrpc.plugin.charger.ocpp.status.query({
        chargerRowId: await ocppRowId(),
      });
      return s.connected ? s : null;
    }, { label: "sap-test connected", timeoutMs: 60_000 });
    // chargePointVendor/chargePointModel from devtools/sap-ocpp-simulator/config/e2e/station-templates/sap-test.station-template.json.
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
    // Plug the cable in first: the station boots to Available (no cable) and
    // the engine rightly refuses to start charging an empty connector.
    await vcpSend("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Preparing",
    });
    await trpc.charger.setMode.mutate({ id: charger.id, mode: "charge_now" });

    // The station auto-sends StartTransaction + StatusNotification(Charging)
    // after accepting RemoteStartTransaction, so the test injects neither.
    const state = await waitFor(async () => {
      const list = await trpc.charger.list.query();
      const s = list.find((c) => c.id === charger.id)?.state;
      return s?.isCharging ? s : null;
    }, { label: "charging after RemoteStart" });
    expect(state.status).toBe("charging");
    expect(state.statusDetail).toBe("Charging");
  });

  it("MeterValues flow into charger state", async () => {
    // Re-inject each attempt: the station's own periodic MeterValues race a
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

    // energyAddedKwh = energyRegisterWh - meterStartWh. meterStartWh is
    // normally set once, from the real StartTransaction (0 here) — but
    // OcppCentralSystem's adopt path can instead win a race against that
    // StartTransaction and baseline it to whatever register THIS test's own
    // injected MeterValues happened to carry, if that message is processed
    // first (a real race in the app: see OcppCentralSystem.adoptTransaction).
    // Once set, the baseline is latched for the rest of the transaction, so
    // re-injecting the same 1500Wh reading again can never correct it —
    // asserting an absolute energyAddedKwh here would assume a baseline the
    // test does not control. The DELTA between two distinct readings
    // cancels meterStartWh out under either baseline, so it's what's
    // actually guaranteed, and it still fails if energy accounting breaks
    // (wrong scale, register not tracked, stuck value, etc).
    const state2 = await waitFor(async () => {
      await vcpSend("MeterValues", meterValuesPayload(9000, 3000));
      const list = await trpc.charger.list.query();
      const s = list.find((c) => c.state?.chargePowerKw === 9)?.state;
      return s ?? null;
    }, { label: "second meter values reflected" });
    expect(state2.energyAddedKwh - state.energyAddedKwh).toBeCloseTo(1.5, 1);
  });

  it("SuspendedEV maps to suspended with raw statusDetail", async () => {
    const state = await waitFor(async () => {
      // Re-inject each attempt, same reason as the MeterValues test above:
      // a one-shot StatusNotification races the station's own periodic one
      // and can be gone before the poll ever sees it.
      await vcpSend("StatusNotification", {
        connectorId: 1,
        errorCode: "NoError",
        status: "SuspendedEV",
      });
      const list = await trpc.charger.list.query();
      const s = list.find((c) => c.state?.status === "suspended")?.state;
      return s ?? null;
    }, { label: "suspended status" });
    expect(state.isCharging).toBe(false);
    expect(state.statusDetail).toBe("SuspendedEV");
  });

  it("Reserved maps to suspended with raw statusDetail", async () => {
    // Booked ≠ ready: Reserved must not read as "available" (STATUS_MAP).
    const state = await waitFor(async () => {
      // Re-injected per attempt too — see the SuspendedEV test above.
      await vcpSend("StatusNotification", {
        connectorId: 1,
        errorCode: "NoError",
        status: "Reserved",
      });
      const s = (await ocppRow())?.state;
      return s?.statusDetail === "Reserved" ? s : null;
    }, { label: "reserved status" });
    expect(state.status).toBe("suspended");
    expect(state.isPluggedIn).toBe(false); // Reserved = no cable
  });

  it("stop mode sends RemoteStop and the transaction ends", async () => {
    const chargerId = await ocppRowId();
    // Re-establish a real charging state rather than inheriting whatever the
    // status-mapping tests above left behind. They inject SuspendedEV and
    // Reserved, which move the APP's view to not-charging while the STATION
    // keeps its transaction open — and the controller has no reason to send
    // RemoteStop for a charge point it already believes is stopped. Driving
    // both sides back into agreement is what makes this test about stop
    // control rather than about test ordering.
    await waitFor(async () => {
      await vcpSend("StatusNotification", {
        connectorId: 1,
        errorCode: "NoError",
        status: "Charging",
      });
      const s = (await trpc.charger.list.query())
        .find((c) => c.id === chargerId)?.state;
      return s?.isCharging === true ? s : null;
    }, { label: "app sees charging again before stop" });

    // Prove the precondition. remoteStop() falls back to suspendCharging()
    // when it holds no transaction id, so without a live transaction this
    // test would pass while proving nothing.
    await waitFor(async () => await sapTransactionStarted() || null, {
      label: "station transaction running before stop",
    });

    await trpc.charger.setMode.mutate({ id: chargerId, mode: "stop" });

    // The station's own state, not a status the test injected: a remoteStop()
    // that never sends RemoteStopTransaction must fail here.
    await waitFor(async () => await sapTransactionStarted() ? null : true, {
      label: "station ended the transaction after RemoteStop",
    });

    const state = await waitFor(async () => {
      const s = (await trpc.charger.list.query())
        .find((c) => c.id === chargerId)?.state;
      return s?.isCharging === false ? s : null;
    }, { label: "app sees charging stopped" });
    expect(state.isCharging).toBe(false);
  });

  it("Available maps to available with no cable", async () => {
    const state = await waitFor(async () => {
      // Re-injected per attempt too — see the SuspendedEV test above. Also
      // guards on isPluggedIn !== null: "available" is not only reached via
      // a raw Available status, it is also the inferred default while raw
      // status is still null (resolveStatus), and in that branch
      // isPluggedIn stays null (unknown) rather than the real false —
      // so a poll must not accept "available" on its own, or the assertion
      // below can run against that unresolved state instead of the one this
      // test actually injected.
      await vcpSend("StatusNotification", {
        connectorId: 1,
        errorCode: "NoError",
        status: "Available",
      });
      const s = (await ocppRow())?.state;
      return s?.status === "available" && s.isPluggedIn !== null ? s : null;
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
    // Shrink the meter timeout rather than mock the clock: keeps the check
    // in-band and deterministic.
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
// second station (devtools/sap-ocpp-simulator/config/e2e/station-templates/sap-basic.station-template.json), which starts
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
