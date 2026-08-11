import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { Logger } from "@chargeha/server/lib/Logger";
import type {
  CallContext,
  ChargerAdapter,
  ChargerInfo,
  ChargerState,
} from "@chargeha/shared";
import { PollingChargerMiddleware } from "./PollingChargerMiddleware.ts";

interface Handlers {
  getChargerState: (callIndex: number) => Promise<ChargerState>;
  getChargerInfo: () => Promise<ChargerInfo>;
  startCharging: () => Promise<boolean>;
  stopCharging: () => Promise<boolean>;
  setChargeAmps: (amps: number) => Promise<boolean>;
}

// Stub over the ChargerAdapter surface PollingChargerMiddleware calls.
// Records call order; unstubbed methods throw so a test only exercising
// a subset of the interface still catches unexpected device calls.
class StubChargerAdapter implements ChargerAdapter {
  readonly calls: string[] = [];
  disconnectCalls = 0;

  constructor(
    private readonly pollInterval: number | null,
    private readonly handlers: Partial<Handlers> = {},
  ) {}

  private static notStubbed(name: string): () => never {
    return () => {
      throw new Error(`StubChargerAdapter: ${name} not stubbed for this test`);
    };
  }

  pollIntervalSeconds(): number | null {
    return this.pollInterval;
  }

  getChargerState(_ctx: CallContext): Promise<ChargerState> {
    this.calls.push("getChargerState");
    const callIndex = this.calls.filter((c) => c === "getChargerState").length -
      1;
    return (this.handlers.getChargerState ??
      StubChargerAdapter.notStubbed("getChargerState"))(callIndex);
  }

  getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    this.calls.push("getChargerInfo");
    return (this.handlers.getChargerInfo ??
      StubChargerAdapter.notStubbed("getChargerInfo"))();
  }

  startCharging(_ctx: CallContext): Promise<boolean> {
    this.calls.push("startCharging");
    return (this.handlers.startCharging ??
      StubChargerAdapter.notStubbed("startCharging"))();
  }

  stopCharging(_ctx: CallContext): Promise<boolean> {
    this.calls.push("stopCharging");
    return (this.handlers.stopCharging ??
      StubChargerAdapter.notStubbed("stopCharging"))();
  }

  setChargeAmps(amps: number, _ctx: CallContext): Promise<boolean> {
    this.calls.push("setChargeAmps");
    return (this.handlers.setChargeAmps ??
      StubChargerAdapter.notStubbed("setChargeAmps"))(amps);
  }

  disconnect(): Promise<void> {
    this.disconnectCalls++;
    return Promise.resolve();
  }
}

// Records error() calls instead of writing to the console.
class SpyLogger extends Logger {
  readonly errorCalls: Array<{ message: string; args: unknown[] }> = [];

  constructor() {
    super("PollingTest", "error");
  }

  override error(message: string, ...args: unknown[]): void {
    this.errorCalls.push({ message, args });
  }
}

describe("PollingChargerMiddleware", () => {
  const ctx: CallContext = { origin: "test", traceId: "test-trace" };

  const buildState = (overrides: Partial<ChargerState> = {}): ChargerState => ({
    chargerId: "charger-1",
    isCharging: true,
    isPluggedIn: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 6,
    chargePowerKw: 3.84,
    chargerVoltage: 240,
    chargerPhases: 1,
    energyAddedKwh: 0,
    status: "charging",
    statusDetail: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
    ...overrides,
  });

  const buildInfo = (overrides: Partial<ChargerInfo> = {}): ChargerInfo => ({
    id: "charger-1",
    name: "Test Charger",
    vendor: "Acme",
    model: "X1",
    firmwareVersion: "1.0.0",
    maxAmps: 32,
    minAmps: 6,
    phases: 1,
    connectorCount: 1,
    controlMode: "amps",
    ...overrides,
  });

  describe("polled adapter caching", () => {
    it("first requestState fetches from the adapter", async () => {
      const adapter = new StubChargerAdapter(30, {
        getChargerState: () => Promise.resolve(buildState()),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      const state = await middleware.requestState(ctx);

      expect(state).toEqual(buildState());
      expect(adapter.calls).toEqual(["getChargerState"]);
    });

    it("serves cached state within the poll interval without calling the adapter", async () => {
      using fakeTime = new FakeTime();
      const adapter = new StubChargerAdapter(30, {
        getChargerState: () => Promise.resolve(buildState()),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      await middleware.requestState(ctx);
      fakeTime.tick(29_000);
      const second = await middleware.requestState(ctx);

      expect(second).toEqual(buildState());
      expect(adapter.calls).toEqual(["getChargerState"]);
    });

    it("fetches again once the poll interval elapses", async () => {
      using fakeTime = new FakeTime();
      const states = [
        buildState({ energyAddedKwh: 1 }),
        buildState({ energyAddedKwh: 2 }),
      ];
      const adapter = new StubChargerAdapter(30, {
        getChargerState: (i) => Promise.resolve(states[i]),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      const first = await middleware.requestState(ctx);
      fakeTime.tick(30_000);
      const second = await middleware.requestState(ctx);

      expect(first).toEqual(states[0]);
      expect(second).toEqual(states[1]);
      expect(adapter.calls).toEqual(["getChargerState", "getChargerState"]);
    });
  });

  describe("push adapter (pollIntervalSeconds returns null)", () => {
    it("calls getChargerState on every requestState", async () => {
      const adapter = new StubChargerAdapter(null, {
        getChargerState: () => Promise.resolve(buildState()),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      await middleware.requestState(ctx);
      await middleware.requestState(ctx);
      await middleware.requestState(ctx);

      expect(adapter.calls).toEqual([
        "getChargerState",
        "getChargerState",
        "getChargerState",
      ]);
    });
  });

  describe("fetch failure", () => {
    it("logs the error and serves the previous cached state", async () => {
      const goodState = buildState({ energyAddedKwh: 5 });
      const responses = [
        () => Promise.resolve(goodState),
        () => Promise.reject(new Error("device offline")),
      ];
      const adapter = new StubChargerAdapter(null, {
        getChargerState: (i) => responses[i](),
      });
      const logger = new SpyLogger();
      const middleware = new PollingChargerMiddleware(adapter, logger);

      const good = await middleware.requestState(ctx);
      const afterFailure = await middleware.requestState(ctx);

      expect(good).toEqual(goodState);
      expect(afterFailure).toEqual(goodState);
      expect(logger.errorCalls.length).toBe(1);
    });
  });

  describe("getCachedState", () => {
    it("returns null before any fetch and triggers no device calls", () => {
      const adapter = new StubChargerAdapter(30);
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      const cached = middleware.getCachedState();

      expect(cached).toBeNull();
      expect(adapter.calls).toEqual([]);
    });

    it("returns the last fetched state without calling the adapter", async () => {
      const adapter = new StubChargerAdapter(30, {
        getChargerState: () => Promise.resolve(buildState()),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());
      await middleware.requestState(ctx);

      const cached = middleware.getCachedState();

      expect(cached).toEqual(buildState());
      expect(adapter.calls).toEqual(["getChargerState"]);
    });
  });

  describe("command delegation", () => {
    it("startCharging returns the adapter's result", async () => {
      const adapter = new StubChargerAdapter(30, {
        startCharging: () => Promise.resolve(true),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      const result = await middleware.startCharging(ctx);

      expect(result).toBe(true);
      expect(adapter.calls).toEqual(["startCharging"]);
    });

    it("stopCharging returns the adapter's result", async () => {
      const adapter = new StubChargerAdapter(30, {
        stopCharging: () => Promise.resolve(false),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      const result = await middleware.stopCharging(ctx);

      expect(result).toBe(false);
      expect(adapter.calls).toEqual(["stopCharging"]);
    });

    it("setChargeAmps passes amps through and returns the adapter's result", async () => {
      const adapter = new StubChargerAdapter(30, {
        setChargeAmps: (amps) => Promise.resolve(amps === 16),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      const result = await middleware.setChargeAmps(16, ctx);

      expect(result).toBe(true);
      expect(adapter.calls).toEqual(["setChargeAmps"]);
    });

    it("getChargerInfo returns the adapter's info", async () => {
      const adapter = new StubChargerAdapter(30, {
        getChargerInfo: () => Promise.resolve(buildInfo()),
      });
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      const info = await middleware.getChargerInfo(ctx);

      expect(info).toEqual(buildInfo());
    });
  });

  describe("shutdown", () => {
    it("disconnects the adapter", async () => {
      const adapter = new StubChargerAdapter(30);
      const middleware = new PollingChargerMiddleware(adapter, new SpyLogger());

      await middleware.shutdown();

      expect(adapter.disconnectCalls).toBe(1);
    });
  });
});
