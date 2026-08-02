import { expect } from "@std/expect";
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { trpc, waitFor } from "./helpers.ts";
import { tapoControl, tapoState } from "./tapoHelpers.ts";

describe("Tapo e2e", () => {
  const SIM_HOST = "172.30.99.50";
  const SIM_SUBNET = "172.30.99";
  const CREDS = { email: "user@example.com", password: "example-password" };

  beforeAll(async () => {
    // 5s loop: the suites otherwise idle on the 30s default for most
    // of their runtime. Config is per-stack (fresh DB every run).
    await trpc.config.system.set.mutate({ controllerLoopSeconds: 5 });
    await tapoControl({ deviceOn: false, drawWhenOnW: 0, unreachable: false });
    await trpc.plugin.charger.tapo.setConfig.mutate({
      tapoHost: SIM_HOST,
      tapoEmail: CREDS.email,
      tapoPassword: CREDS.password,
      tapoFixedDrawAmps: "10",
      tapoDetectionThresholdW: "100",
      tapoPollIntervalSeconds: "2",
    });
  });

  afterAll(async () => {
    await tapoControl({ deviceOn: false });
  });

  it("discovers the simulator on the subnet", async () => {
    const { found } = await trpc.plugin.charger.tapo.discover.mutate({
      subnet: SIM_SUBNET,
    });
    expect(found.map((d) => d.host)).toContain(SIM_HOST);
  });

  it("test-connection succeeds with correct credentials", async () => {
    const result = await trpc.plugin.charger.tapo.testConnection.mutate({
      host: SIM_HOST,
      ...CREDS,
    });
    expect(result.success).toBe(true);
  });

  it("test-connection reports wrong credentials distinctly", async () => {
    const result = await trpc.plugin.charger.tapo.testConnection.mutate({
      host: SIM_HOST,
      email: CREDS.email,
      password: "wrong-password",
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain(
      "email or password",
    );
  });

  it("charge_now switches the plug on and detects draw", async () => {
    const charger = await trpc.charger.create.mutate({
      name: "E2E Plug",
      chargerAdapterType: "tapo",
    });
    await trpc.charger.setMode.mutate({ id: charger.id, mode: "charge_now" });

    await waitFor(async () => (await tapoState()).deviceOn === true, {
      label: "plug switched on",
    });

    await tapoControl({ drawWhenOnW: 2400 }); // car draws 2.4 kW
    const charging = await waitFor(async () => {
      const list = await trpc.charger.list.query();
      const state = list.find((c) => c.id === charger.id)?.state;
      return state?.isCharging && state.status === "charging" ? state : null;
    }, { label: "state shows charging" });
    expect(charging.chargePowerKw).toBeCloseTo(2.4, 1);

    await trpc.charger.setMode.mutate({ id: charger.id, mode: "stop" });
    await waitFor(async () => (await tapoState()).deviceOn === false, {
      label: "plug switched off",
    });
  });

  it("no-draw shows no_draw and records no charge power", async () => {
    // The CONTROLLER must switch the plug on (charge_now) while the "car"
    // draws nothing — flipping the plug on externally in stop mode just
    // gets it correctly switched off again. Spans two controller loops
    // (start command, then the below-threshold poll), hence the timeout.
    await tapoControl({ drawWhenOnW: 0 });
    const chargers = await trpc.charger.list.query();
    const charger = chargers.find((c) => c.chargerAdapterType === "tapo");
    await trpc.charger.setMode.mutate({
      id: charger?.id ?? "",
      mode: "charge_now",
    });
    const state = await waitFor(async () => {
      const list = await trpc.charger.list.query();
      const s = list.find((c) => c.chargerAdapterType === "tapo")?.state;
      return s?.status === "no_draw" ? s : null;
    }, { label: "no_draw status", timeoutMs: 120_000 });
    expect(state.isCharging).toBe(false);
    expect(state.chargePowerKw).toBe(0);
    await trpc.charger.setMode.mutate({ id: charger?.id ?? "", mode: "stop" });
  });

  it("rejects a meterless model (P100/P105) with a clear error", async () => {
    await tapoControl({ meterless: true, model: "P100" });
    const result = await trpc.plugin.charger.tapo.testConnection.mutate({
      host: SIM_HOST,
      ...CREDS,
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain(
      "no energy meter",
    );
    await tapoControl({ meterless: false, model: "P110" });
  });

  // No negative-case meterless test on purpose: the classification treats
  // ANY device-level error from get_energy_usage as meterless, by design —
  // narrowing it needs the real "method unsupported" error codes, which
  // only hardware can confirm (no-guessing rule).
  // TODO: capture the real P100 and P110 error codes during hardware
  // validation and narrow the check + add the negative test then.

  it("configured charger passes the health check (no warning)", async () => {
    const warnings = await trpc.health.pluginWarnings.query();
    expect(warnings.some((w) => w.title.includes("Tapo"))).toBe(false);
  });

  it("session energy accumulates while drawing", async () => {
    await tapoControl({ deviceOn: true, drawWhenOnW: 2400 });
    const state = await waitFor(async () => {
      const s = (await trpc.charger.list.query())
        .find((c) => c.chargerAdapterType === "tapo")?.state;
      return s && s.energyAddedKwh > 0 ? s : null;
    }, { label: "session energy accumulating" });
    expect(state.energyAddedKwh).toBeGreaterThan(0);
    await tapoControl({ deviceOn: false, drawWhenOnW: 0 });
  });

  it("adapter session survives KLAP session expiry (re-handshake)", async () => {
    // The long-lived KLAP client lives in the adapter (held by
    // PollingChargerMiddleware). Router procedures build a FRESH client per
    // call, so probing testConnection here would pass even with the
    // 403-re-handshake logic deleted. Drive the adapter instead: charge,
    // expire the simulator's session mid-poll, and assert polled state
    // stays fresh — the same client recovered transparently.
    await tapoControl({ deviceOn: true, drawWhenOnW: 2400 });
    await waitFor(async () => {
      const s = (await trpc.charger.list.query())
        .find((c) => c.chargerAdapterType === "tapo")?.state;
      return s?.isCharging ? s : null;
    }, { label: "charging before expiry" });

    await tapoControl({ expireSession: true });

    const after = await waitFor(async () => {
      const s = (await trpc.charger.list.query())
        .find((c) => c.chargerAdapterType === "tapo")?.state;
      const fresh = s !== undefined && s !== null &&
        Date.now() - Date.parse(s.lastUpdated) < 15_000;
      return fresh && s.status !== "faulted" ? s : null;
    }, { label: "fresh state after session expiry" });
    expect(after.status).not.toBe("faulted");
    await tapoControl({ deviceOn: false, drawWhenOnW: 0 });
  });

  it("unreachable device surfaces the health warning", async () => {
    await tapoControl({ unreachable: true });
    const health = await waitFor(async () => {
      const warnings = await trpc.health.pluginWarnings.query();
      return warnings.find((w) => w.title.includes("Tapo")) ?? null;
    }, { label: "health warning raised" });
    expect(health).toBeTruthy();
    await tapoControl({ unreachable: false });
  });
});
