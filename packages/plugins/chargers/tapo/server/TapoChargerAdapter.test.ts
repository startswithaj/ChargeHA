// Regressions an e2e suite can't catch deterministically: the sequential
// request-ordering guarantee (one in-flight KLAP request per plug) and the
// session/staleness state machine. A spy KlapClient stands in for the real
// one — only the `request()` surface the adapter actually calls.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { CallContext } from "@chargeha/shared";
import { KlapClient } from "./KlapClient.ts";
import {
  type TapoAdapterConfig,
  TapoChargerAdapter,
  type TapoDeviceInfo,
  type TapoEnergyUsage,
} from "./TapoChargerAdapter.ts";

interface Handlers {
  get_device_info: (callIndex: number) => Promise<TapoDeviceInfo>;
  get_energy_usage: (callIndex: number) => Promise<TapoEnergyUsage>;
  set_device_info: (params?: Record<string, unknown>) => Promise<void>;
}

// Minimal spy over the KlapClient surface TapoChargerAdapter calls: only
// `request()`. Records call order and hands each call its own index within
// that method (so a test can vary the response poll-by-poll).
class SpyKlapClient extends KlapClient {
  readonly calls: string[] = [];

  constructor(
    private readonly handlers: Partial<Handlers>,
    logger: Logger,
  ) {
    super(
      "192.0.2.10",
      "user@example.com",
      "example-password",
      logger,
      new PluginDbLogger(() => Promise.resolve(), logger),
      "charger-1",
    );
  }

  private static notStubbed(name: string): () => never {
    return () => {
      throw new Error(`SpyKlapClient: ${name} not stubbed for this test`);
    };
  }

  override request<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push(method);
    const callIndex = this.calls.filter((m) => m === method).length - 1;
    if (method === "get_device_info") {
      return (this.handlers.get_device_info ??
        SpyKlapClient.notStubbed(method))(
          callIndex,
        ) as Promise<T>;
    }
    if (method === "get_energy_usage") {
      return (this.handlers.get_energy_usage ??
        SpyKlapClient.notStubbed(method))(
          callIndex,
        ) as Promise<T>;
    }
    if (method === "set_device_info") {
      return (this.handlers.set_device_info ??
        SpyKlapClient.notStubbed(method))(
          params,
        ) as Promise<T>;
    }
    throw new Error(`SpyKlapClient: unexpected method ${method}`);
  }
}

describe("TapoChargerAdapter", () => {
  const ctx: CallContext = { origin: "test", traceId: "test-trace" };
  const logger = new Logger("TapoTest", "error");
  const dbLog = new PluginDbLogger(() => Promise.resolve(), logger);

  const CONFIG: TapoAdapterConfig = {
    chargerId: "charger-1",
    fixedDrawAmps: 10,
    detectionThresholdW: 100,
    pollSeconds: 10,
    staleTimeoutSeconds: 60,
  };

  const buildDeviceInfo = (
    overrides: Partial<TapoDeviceInfo> = {},
  ): TapoDeviceInfo => ({
    device_on: true,
    model: "P110",
    fw_ver: "1.3.0 Build 240523",
    mac: "AA-BB-CC-00-11-22",
    nickname: btoa("Test Plug"),
    overheated: false,
    ...overrides,
  });

  const buildEnergyUsage = (
    overrides: Partial<TapoEnergyUsage> = {},
  ): TapoEnergyUsage => ({
    current_power: 0,
    today_energy: 0,
    month_energy: 0,
    ...overrides,
  });

  describe("getChargerState request ordering", () => {
    it("fully resolves get_device_info before sending get_energy_usage", async () => {
      const deviceInfoGate = Promise.withResolvers<TapoDeviceInfo>();
      const client = new SpyKlapClient({
        get_device_info: () => deviceInfoGate.promise,
        get_energy_usage: () => Promise.resolve(buildEnergyUsage()),
      }, logger);
      const adapter = new TapoChargerAdapter(CONFIG, client, logger, dbLog);

      const statePromise = adapter.getChargerState(ctx);

      // get_device_info hasn't resolved yet — get_energy_usage must not have
      // been sent, proving the requests are sequential, not concurrent.
      await Promise.resolve();
      expect(client.calls).toEqual(["get_device_info"]);

      deviceInfoGate.resolve(buildDeviceInfo());
      const state = await statePromise;

      expect(client.calls).toEqual(["get_device_info", "get_energy_usage"]);
      expect(state.chargerId).toBe(CONFIG.chargerId);
    });
  });

  describe("fixed draw amps from config", () => {
    it("reports the configured fixed draw as both max and min amps", async () => {
      const client = new SpyKlapClient({
        get_device_info: () => Promise.resolve(buildDeviceInfo()),
        get_energy_usage: () => Promise.resolve(buildEnergyUsage()),
      }, logger);
      const adapter = new TapoChargerAdapter(
        { ...CONFIG, fixedDrawAmps: 12 },
        client,
        logger,
        dbLog,
      );

      const state = await adapter.getChargerState(ctx);

      // A switch-only plug can't modulate: the configured draw is the only
      // current figure the engine gets.
      expect(state.chargeAmpsMax).toBe(12);
      expect(state.chargeAmpsMin).toBe(12);
      expect(state.controlMode).toBe("switch");
    });
  });

  describe("device_on gating", () => {
    it("isCharging is false when device_on is false, even above the power threshold", async () => {
      const client = new SpyKlapClient({
        get_device_info: () =>
          Promise.resolve(buildDeviceInfo({ device_on: false })),
        get_energy_usage: () =>
          Promise.resolve(buildEnergyUsage({ current_power: 500_000 })), // 500 W, well above threshold
      }, logger);
      const adapter = new TapoChargerAdapter(CONFIG, client, logger, dbLog);

      const state = await adapter.getChargerState(ctx);

      expect(state.isCharging).toBe(false);
      expect(state.status).toBe("available");
    });

    it("ends an active session immediately when device_on flips false", async () => {
      const deviceOnByPoll = [true, false];
      const client = new SpyKlapClient({
        get_device_info: (i) =>
          Promise.resolve(buildDeviceInfo({ device_on: deviceOnByPoll[i] })),
        get_energy_usage: () =>
          Promise.resolve(
            buildEnergyUsage({ current_power: 2_000_000, today_energy: 500 }),
          ),
      }, logger);
      const adapter = new TapoChargerAdapter(CONFIG, client, logger, dbLog);

      const charging = await adapter.getChargerState(ctx);
      expect(charging.isCharging).toBe(true);

      // Device switched off — session ends on this single poll, not after
      // the 2-poll below-threshold grace period.
      const stopped = await adapter.getChargerState(ctx);
      expect(stopped.isCharging).toBe(false);
      expect(stopped.status).toBe("available");
    });
  });

  describe("session end grace period", () => {
    it("stays charging through the first below-threshold poll, ends on the second", async () => {
      const powerByPollW = [2000, 50, 50]; // threshold is 100 W
      const client = new SpyKlapClient({
        get_device_info: () =>
          Promise.resolve(buildDeviceInfo({ device_on: true })),
        get_energy_usage: (i) =>
          Promise.resolve(
            buildEnergyUsage({
              current_power: powerByPollW[i] * 1000,
              today_energy: 100 * (i + 1),
            }),
          ),
      }, logger);
      const adapter = new TapoChargerAdapter(CONFIG, client, logger, dbLog);

      const above = await adapter.getChargerState(ctx);
      expect(above.isCharging).toBe(true);

      const firstBelow = await adapter.getChargerState(ctx);
      expect(firstBelow.isCharging).toBe(true); // grace poll 1 — session still active

      const secondBelow = await adapter.getChargerState(ctx);
      expect(secondBelow.isCharging).toBe(false); // grace poll 2 — session ends
      expect(secondBelow.status).toBe("no_draw");
    });
  });

  describe("poll failure", () => {
    it("serves stale state on failure, then flips to faulted after the stale timeout", async () => {
      using fakeTime = new FakeTime();
      const goodInfo = buildDeviceInfo({ device_on: true });
      const goodEnergy = buildEnergyUsage({
        current_power: 2_000_000,
        today_energy: 100,
      });
      const client = new SpyKlapClient({
        get_device_info: (i) =>
          i === 0
            ? Promise.resolve(goodInfo)
            : Promise.reject(new Error("device offline")),
        get_energy_usage: () => Promise.resolve(goodEnergy),
      }, logger);
      const adapter = new TapoChargerAdapter(CONFIG, client, logger, dbLog);

      const good = await adapter.getChargerState(ctx);
      expect(good.status).toBe("charging");

      const staleButFresh = await adapter.getChargerState(ctx);
      expect(staleButFresh.status).toBe("charging"); // still serving the last good state
      expect(staleButFresh.isCharging).toBe(true);

      await fakeTime.tickAsync(CONFIG.staleTimeoutSeconds * 1000);

      const faulted = await adapter.getChargerState(ctx);
      expect(faulted.status).toBe("faulted");
      expect(faulted.statusDetail).toBe("unreachable");
    });
  });

  // A plug that is already offline when the server starts has no last good
  // state to fall back on — the dashboard still has to say why it is blank.
  describe("poll failure with no successful poll ever", () => {
    const offlineClient = () =>
      new SpyKlapClient({
        get_device_info: () => Promise.reject(new Error("device offline")),
      }, logger);

    it("throws inside the grace window, leaving the card on 'waiting for data'", async () => {
      const adapter = new TapoChargerAdapter(
        CONFIG,
        offlineClient(),
        logger,
        dbLog,
      );

      await expect(adapter.getChargerState(ctx)).rejects.toThrow(
        "device offline",
      );
    });

    it("reports unreachable once the stale window elapses", async () => {
      using fakeTime = new FakeTime();
      const adapter = new TapoChargerAdapter(
        CONFIG,
        offlineClient(),
        logger,
        dbLog,
      );

      // First attempt starts the stale window; it can only throw.
      await expect(adapter.getChargerState(ctx)).rejects.toThrow();
      await fakeTime.tickAsync(CONFIG.staleTimeoutSeconds * 1000);
      const faulted = await adapter.getChargerState(ctx);

      expect(faulted.status).toBe("faulted");
      expect(faulted.statusDetail).toBe("unreachable");
      expect(faulted.chargerId).toBe(CONFIG.chargerId);
      expect(faulted.isCharging).toBe(false);
      expect(faulted.chargeAmpsMax).toBe(CONFIG.fixedDrawAmps);
    });

    it("reports nothing measured rather than zeroes", async () => {
      using fakeTime = new FakeTime();
      const adapter = new TapoChargerAdapter(
        CONFIG,
        offlineClient(),
        logger,
        dbLog,
      );

      await expect(adapter.getChargerState(ctx)).rejects.toThrow();
      await fakeTime.tickAsync(CONFIG.staleTimeoutSeconds * 1000);
      const faulted = await adapter.getChargerState(ctx);

      expect(faulted.chargeAmps).toBeNull();
      expect(faulted.chargePowerKw).toBeNull();
      expect(faulted.chargerVoltage).toBeNull();
      expect(faulted.isPluggedIn).toBeNull();
    });

    it("keeps one timestamp across the outage so core emits the fault once", async () => {
      using fakeTime = new FakeTime();
      const adapter = new TapoChargerAdapter(
        CONFIG,
        offlineClient(),
        logger,
        dbLog,
      );

      await expect(adapter.getChargerState(ctx)).rejects.toThrow();
      await fakeTime.tickAsync(CONFIG.staleTimeoutSeconds * 1000);
      const first = await adapter.getChargerState(ctx);
      await fakeTime.tickAsync(CONFIG.pollSeconds * 1000);
      const second = await adapter.getChargerState(ctx);

      expect(second.lastUpdated).toBe(first.lastUpdated);
    });
  });
});
