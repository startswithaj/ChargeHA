// A 3-phase charger reports one sampledValue per phase. Reading only the
// first match under-reports power threefold and can mistake a line-to-line
// voltage for a line-to-neutral one. These drive the aggregation over the
// same fake socket the adoption tests use, rather than asserting on
// internals. Split across several top-level describes: a describe callback
// counts against the 200-line function-length cap.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { CallContext } from "@chargeha/shared";
import {
  attached,
  call,
  meterValues,
  phased,
} from "./test-helpers/ocppHarness.ts";
import type { OcppChargerHandle } from "./OcppCentralSystem.ts";
import type { OcppLiveData } from "./OcppTypes.ts";
import { OcppChargerAdapter } from "./OcppChargerAdapter.ts";

describe("OCPP MeterValues — power and energy sum over phases", () => {
  const CP = "ABB-83214";

  it("sums Power.Active.Import across L1/L2/L3 instead of reading one phase", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      phased("Power.Active.Import", [
        ["L1", "1000"],
        ["L2", "1000"],
        ["L3", "1000"],
      ]),
    );

    expect(cs.getData(CP).powerW).toBe(3000);
  });

  it("normalises the unit after aggregating, so 1 kW per phase is 3000 W", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      phased(
        "Power.Active.Import",
        [["L1", "1"], ["L2", "1"], ["L3", "1"]],
        "kW",
      ),
    );

    expect(cs.getData(CP).powerW).toBe(3000);
  });

  it("sums a per-phase energy register and then scales kWh to Wh", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      phased(
        "Energy.Active.Import.Register",
        [["L1", "0.5"], ["L2", "0.5"], ["L3", "0.5"]],
        "kWh",
      ),
    );

    expect(cs.getData(CP).energyRegisterWh).toBe(1500);
  });

  it("falls back to summing the line-to-neutral labels when there is no L1/L2/L3", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      phased("Power.Active.Import", [
        ["L1-N", "1100"],
        ["L2-N", "1100"],
        ["L3-N", "1100"],
      ]),
    );

    expect(cs.getData(CP).powerW).toBe(3300);
  });
});

describe("OCPP MeterValues — current averages over phases", () => {
  const CP = "ABB-83214";

  const currentOf = (entries: Array<[string, string]>) =>
    phased("Current.Import", entries);

  it("averages the per-phase currents and keeps their sum", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      currentOf([["L1", "10"], ["L2", "10"], ["L3", "10"]]),
    );

    expect(cs.getData(CP).currentA).toBe(10);
    expect(cs.getData(CP).currentSumA).toBe(30);
  });

  it("ignores the neutral conductor when averaging current", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      currentOf([["L1", "16"], ["L2", "16"], ["L3", "16"], ["N", "5"]]),
    );

    expect(cs.getData(CP).currentA).toBe(16);
    expect(cs.getData(CP).currentSumA).toBe(48);
  });

  it("reads an unbalanced 16/16/0 as 16 A, not 10.67 — an idle phase is not headroom", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      currentOf([["L1", "16"], ["L2", "16"], ["L3", "0"]]),
    );

    expect(cs.getData(CP).currentA).toBe(16);
    expect(cs.getData(CP).currentSumA).toBe(32);
  });

  it("excludes an absent phase from the average rather than treating it as zero", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(socket, currentOf([["L1", "16"], ["L2", "16"]]));

    expect(cs.getData(CP).currentA).toBe(16);
    expect(cs.getData(CP).currentSumA).toBe(32);
  });

  it("accepts line-to-neutral labels for current — some chargers misreport them", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      currentOf([["L1-N", "12"], ["L2-N", "12"], ["L3-N", "12"]]),
    );

    expect(cs.getData(CP).currentA).toBe(12);
    expect(cs.getData(CP).currentSumA).toBe(36);
  });

  it("reports no sum for a single unphased current — there is nothing to sum", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(socket, [{ measurand: "Current.Import", value: "16" }]);

    expect(cs.getData(CP).currentA).toBe(16);
    expect(cs.getData(CP).currentSumA).toBeNull();
  });
});

describe("OCPP MeterValues — voltage", () => {
  const CP = "ABB-83214";

  const voltageOf = (entries: Array<[string, string]>) =>
    phased("Voltage", entries);

  it("prefers the line-to-neutral phases over any line-to-line sample present", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(socket, [
      ...voltageOf([["L1-N", "230"], ["L2-N", "230"], ["L3-N", "230"]]),
      ...voltageOf([["L1-L2", "400"]]),
    ]);

    expect(cs.getData(CP).voltageV).toBe(230);
  });

  it("converts averaged line-to-line volts to line-to-neutral via sqrt(3)", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      voltageOf([["L1-L2", "400"], ["L2-L3", "400"], ["L3-L1", "400"]]),
    );

    const voltage = cs.getData(CP).voltageV;
    assertExists(voltage);
    expect(voltage).toBeCloseTo(400 / Math.sqrt(3), 6);
  });

  it("treats bare L1/L2/L3 volts as line-to-neutral — a charger convention workaround", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      voltageOf([["L1", "230"], ["L2", "231"], ["L3", "232"]]),
    );

    expect(cs.getData(CP).voltageV).toBe(231);
  });
});

describe("OCPP MeterValues — malformed, partial and legacy payloads", () => {
  const CP = "ABB-83214";

  it("ignores a measurand whose only phase is N, keeping the reading already held", async () => {
    const { cs, socket } = attached(CP);
    await meterValues(socket, [{ measurand: "Voltage", value: "230" }]);
    expect(cs.getData(CP).voltageV).toBe(230);

    await meterValues(socket, phased("Voltage", [["N", "0"]]));

    expect(cs.getData(CP).voltageV).toBe(230);
  });

  it("takes an unphased total over the per-phase entries of the same measurand", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(socket, [
      { measurand: "Power.Active.Import", value: "6000" },
      ...phased("Power.Active.Import", [
        ["L1", "2000"],
        ["L2", "2000"],
        ["L3", "2000"],
      ]),
    ]);

    expect(cs.getData(CP).powerW).toBe(6000);
  });

  it("drops a malformed phase without producing NaN or losing its siblings", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(
      socket,
      phased("Current.Import", [["L1", "abc"], ["L2", "16"], ["L3", "16"]]),
    );

    expect(cs.getData(CP).currentA).toBe(16);
    expect(cs.getData(CP).currentSumA).toBe(32);
  });

  it("reads a fully unphased legacy payload exactly as before", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(socket, [
      { measurand: "Power.Active.Import", value: "3300" },
      { measurand: "Current.Import", value: "15" },
      { measurand: "Voltage", value: "230" },
      { measurand: "Energy.Active.Import.Register", value: "5000" },
    ]);

    const data = cs.getData(CP);
    expect(data.powerW).toBe(3300);
    expect(data.currentA).toBe(15);
    expect(data.currentSumA).toBeNull();
    expect(data.voltageV).toBe(230);
    expect(data.energyRegisterWh).toBe(5000);
  });

  it("lets the last entry of a batched payload win for a repeated phase", async () => {
    const { cs, socket } = attached(CP);

    // Two meterValue entries in one CALL, oldest first — the charger
    // buffered them while offline and flushed both together.
    await call(socket, "MeterValues", {
      connectorId: 1,
      meterValue: [
        {
          timestamp: "2026-01-01T00:00:00.000Z",
          sampledValue: phased("Current.Import", [["L1", "10"]]),
        },
        {
          timestamp: "2026-01-01T00:01:00.000Z",
          sampledValue: phased("Current.Import", [["L1", "20"]]),
        },
      ],
    });

    expect(cs.getData(CP).currentA).toBe(20);
  });
});

describe("OCPP adapter — tier 3 power derivation", () => {
  const ctx: CallContext = { origin: "test", traceId: "trace" };

  const liveData = (overrides: Partial<OcppLiveData>): OcppLiveData => ({
    connected: true,
    status: "Charging",
    errorCode: "NoError",
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

  const adapterFor = (data: OcppLiveData, phases: number) => {
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
        maxAmps: 32,
        minAmps: 6,
        phases,
      },
      handle,
      new PluginDbLogger(() => Promise.resolve(), logger),
    );
  };

  it("derives power from the summed per-phase currents, ignoring config.phases", async () => {
    // phases is deliberately 1 while the charger reports three: the
    // charger's own report must win over the declared installation.
    const adapter = adapterFor(
      liveData({ currentA: 10, currentSumA: 30, voltageV: 230 }),
      1,
    );

    const state = await adapter.getChargerState(ctx);

    expect(state.chargePowerKw).toBeCloseTo(6.9, 9);
    // The engine limits against the per-phase figure, not the sum.
    expect(state.chargeAmps).toBe(10);
  });

  it("scales a single unphased current by the configured phase count", async () => {
    const adapter = adapterFor(
      liveData({ currentA: 10, currentSumA: null, voltageV: 230 }),
      3,
    );

    const state = await adapter.getChargerState(ctx);

    expect(state.chargePowerKw).toBeCloseTo(6.9, 9);
  });

  it("derives nothing without a voltage", async () => {
    const adapter = adapterFor(
      liveData({ currentA: 10, currentSumA: 30, voltageV: null }),
      3,
    );

    const state = await adapter.getChargerState(ctx);

    expect(state.chargePowerKw).toBeNull();
  });

  // A ChargeHA restart resets `status` (attach starts from freshData), and the
  // charger has no reason to re-send Charging for a session it never stopped.
  // The adopted transaction plus real power is then the only honest evidence.
  describe("charging state across a reconnect", () => {
    it("reports charging from a live transaction and real power when the status was never re-announced", async () => {
      const adapter = adapterFor(
        liveData({ status: null, transactionId: 4, powerW: 3763 }),
        1,
      );

      const state = await adapter.getChargerState(ctx);

      expect(state.isCharging).toBe(true);
      expect(state.isPluggedIn).toBe(true);
      // "available" here would read as nothing plugged in mid-session.
      expect(state.status).toBe("charging");
    });

    it("still reports charging when the charger re-announced only Preparing", async () => {
      const adapter = adapterFor(
        liveData({ status: "Preparing", transactionId: 4, powerW: 3763 }),
        1,
      );

      const state = await adapter.getChargerState(ctx);

      expect(state.isCharging).toBe(true);
    });

    it("lets an explicit SuspendedEV beat a stale non-zero power reading", async () => {
      // The power measurand keeps its last value until the next MeterValues,
      // so a session that suspends mid-charge still has watts in the cache.
      // The charger's own status must win over that.
      const adapter = adapterFor(
        liveData({ status: "SuspendedEV", transactionId: 4, powerW: 1500 }),
        1,
      );

      const state = await adapter.getChargerState(ctx);

      expect(state.isCharging).toBe(false);
    });

    it("does not infer charging for a suspended session drawing no power", async () => {
      const adapter = adapterFor(
        liveData({ status: "SuspendedEV", transactionId: 4, powerW: 0 }),
        1,
      );

      const state = await adapter.getChargerState(ctx);

      expect(state.isCharging).toBe(false);
      expect(state.status).toBe("suspended");
    });

    it("does not infer charging with no transaction at all", async () => {
      const adapter = adapterFor(
        liveData({ status: null, transactionId: null, powerW: null }),
        1,
      );

      const state = await adapter.getChargerState(ctx);

      expect(state.isCharging).toBe(false);
      expect(state.isPluggedIn).toBeNull();
      expect(state.status).toBe("available");
    });
  });
});
