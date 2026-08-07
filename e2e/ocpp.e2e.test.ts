import { expect } from "@std/expect";
import { beforeAll, describe, it } from "@std/testing/bdd";
import { trpc, waitFor } from "./helpers.ts";
import { meterValuesPayload, ocppTrpc, vcpSend } from "./ocppHelpers.ts";

describe("OCPP e2e", () => {
  const CP_ID = "vcp-test";

  // Row-scoped procedures (change set 02) need the charger row id, and the
  // row is only created partway through this suite (`charger.create`,
  // below) — same interim assumption as the client's useOcppChargerId hook:
  // the single OCPP row, valid while ensureCharger allows only one per
  // adapter type. Looked up lazily rather than once in beforeAll because it
  // does not exist yet for the first tests in file order.
  //
  // NOTE: per change set 02's spec (§8, sequencing risk #1), no OCPP charger
  // is actually configurable end-to-end until change set 03 lands the
  // row-scoped write path — createPluginConfigProcedures.setConfig here still
  // writes the now-unread plugin-wide `charger_id` key. This suite is
  // expected to stay red until 03 ships; it is kept compiling in the
  // meantime.
  async function ocppRowId(): Promise<string> {
    const list = await trpc.charger.list.query();
    const row = list.find((c) => c.chargerAdapterType === "ocpp");
    if (!row) throw new Error("No OCPP charger row found for e2e setup");
    return row.id;
  }

  beforeAll(async () => {
    // 5s loop: the suites otherwise idle on the 30s default for most
    // of their runtime. Config is per-stack (fresh DB every run).
    await trpc.config.system.set.mutate({ controllerLoopSeconds: 5 });
    await ocppTrpc.plugin.charger.ocpp.setConfig.mutate({
      ocppChargerId: CP_ID,
    });
    // vcp retries via compose restart until the mount accepts it.
  });

  it("charger connects and reports boot info", async () => {
    const status = await waitFor(async () => {
      const s = await ocppTrpc.plugin.charger.ocpp.status.query({
        chargerRowId: await ocppRowId(),
      });
      return s.connected ? s : null;
    }, { label: "vcp connected", timeoutMs: 60_000 });
    expect(status.info?.vendor).toBe("Solidstudio");
    expect(status.info?.model).toBe("VirtualChargePoint");
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
    const charger = await trpc.charger.create.mutate({
      name: "E2E OCPP",
      chargerAdapterType: "ocpp",
    });
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
      const s = (await trpc.charger.list.query())
        .find((c) => c.chargerAdapterType === "ocpp")?.state;
      return s?.statusDetail === "Reserved" ? s : null;
    }, { label: "reserved status" });
    expect(state.status).toBe("suspended");
    expect(state.isPluggedIn).toBe(false); // Reserved = no cable
  });

  it("stop mode sends RemoteStop and the transaction ends", async () => {
    const list = await trpc.charger.list.query();
    const charger = list.find((c) => c.chargerAdapterType === "ocpp");
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
      const s = (await trpc.charger.list.query())
        .find((c) => c.chargerAdapterType === "ocpp")?.state;
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
      const s = (await trpc.charger.list.query())
        .find((c) => c.chargerAdapterType === "ocpp")?.state;
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
      ocppMeterTimeoutSeconds: "5",
    });
    await vcpSend("MeterValues", meterValuesPayload(7200, 2000));
    const state = await waitFor(async () => {
      const s = (await trpc.charger.list.query())
        .find((c) => c.chargerAdapterType === "ocpp")?.state;
      return s?.status === "faulted" ? s : null;
    }, { label: "stale → faulted", timeoutMs: 30_000 });
    expect(state.statusDetail).toBe("stale (no MeterValues)");
    await ocppTrpc.plugin.charger.ocpp.setConfig.mutate({
      ocppMeterTimeoutSeconds: "300",
    });
  });
});
