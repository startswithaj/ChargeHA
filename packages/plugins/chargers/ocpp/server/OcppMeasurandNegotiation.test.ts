// ChargeHA used to accept whatever a charger volunteered, which for a
// minimum-compliant 1.6 charger is the energy register and nothing else.
// These drive the real BootNotification handler over the fake socket and
// answer its CALLs as a charger would. Split across several top-level
// describes: a describe callback counts against the function-length cap.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  answer,
  attached,
  call,
  callsTo,
  type FakeSocket,
  meterValues,
} from "./test-helpers/ocppHarness.ts";

// The MeterValuesSampledData values we asked the charger to store, oldest
// first. Declared per describe (a test file may not hold module-level
// helpers), so this comment stands in for the repetition below.
describe("OCPP measurand negotiation — asking", () => {
  const CP = "ABB-83214";
  const BOOT = { chargePointVendor: "ACME", chargePointModel: "Wallbox9000" };
  const ALL_FOUR = "Energy.Active.Import.Register,Current.Import,Voltage," +
    "Power.Active.Import";

  const configRes = (
    sampled: string,
    extra: Array<Record<string, unknown>> = [],
  ) => ({
    configurationKey: [
      { key: "MeterValuesSampledData", readonly: false, value: sampled },
      ...extra,
    ],
  });

  const changesTo = (socket: FakeSocket, key: string): string[] =>
    callsTo(socket, "ChangeConfiguration")
      .map((frame) => frame[3] as { key: string; value: string })
      .filter((payload) => payload.key === key)
      .map((payload) => payload.value);

  it("asks a register-only charger for all four measurands, in priority order", async () => {
    const { socket } = attached(CP);

    // Awaiting the boot reply: negotiation starts only once it is on the wire.
    await call(socket, "BootNotification", BOOT);
    await answer(socket, configRes("Energy.Active.Import.Register"));
    await answer(socket, { status: "Accepted" });

    expect(changesTo(socket, "MeterValuesSampledData")).toEqual([ALL_FOUR]);
  });

  it("leaves a charger already reporting all four alone", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(socket, configRes(ALL_FOUR));

    expect(callsTo(socket, "ChangeConfiguration")).toHaveLength(0);
  });

  it("still asks for power when the charger reports only the other three", async () => {
    // Current x voltage assumes a power factor of 1 and takes its phase count
    // from configuration rather than measurement, so a measured figure is
    // worth one write.
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(
      socket,
      configRes("Energy.Active.Import.Register,Current.Import,Voltage"),
    );
    await answer(socket, { status: "Accepted" });

    expect(changesTo(socket, "MeterValuesSampledData")).toEqual([ALL_FOUR]);
  });

  it("counts a phase-suffixed Voltage.L1 as voltage rather than rewriting", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(
      socket,
      configRes(
        "Energy.Active.Import.Register,Current.Import,Voltage.L1," +
          "Power.Active.Import",
      ),
    );

    expect(callsTo(socket, "ChangeConfiguration")).toHaveLength(0);
  });

  it("drops from the tail when MeterValuesSampledDataMaxLength binds", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(
      socket,
      configRes("Energy.Active.Import.Register", [{
        key: "MeterValuesSampledDataMaxLength",
        readonly: true,
        value: "2",
      }]),
    );
    await answer(socket, { status: "Accepted" });

    // Power is derivable, so it is the first to go; the register is the only
    // measurand the spec guarantees, so it is the last.
    expect(changesTo(socket, "MeterValuesSampledData")).toEqual([
      "Energy.Active.Import.Register,Current.Import",
    ]);
  });

  it("never negotiates with a charger that has no saved row", async () => {
    const { socket } = attached(CP, { hasRow: false });

    await call(socket, "BootNotification", BOOT);

    expect(callsTo(socket, "GetConfiguration")).toHaveLength(0);
  });

  it("speeds up a slow sample interval and leaves a fast one alone", async () => {
    const slow = attached(CP);
    const fast = attached(CP);

    await call(slow.socket, "BootNotification", BOOT);
    await answer(
      slow.socket,
      configRes(ALL_FOUR, [
        { key: "MeterValueSampleInterval", readonly: false, value: "300" },
      ]),
    );
    await answer(slow.socket, { status: "Accepted" });

    await call(fast.socket, "BootNotification", BOOT);
    await answer(
      fast.socket,
      configRes(ALL_FOUR, [
        { key: "MeterValueSampleInterval", readonly: false, value: "10" },
      ]),
    );

    expect(changesTo(slow.socket, "MeterValueSampleInterval")).toEqual(["30"]);
    expect(changesTo(fast.socket, "MeterValueSampleInterval")).toEqual([]);
  });
});

describe("OCPP measurand negotiation — refusals", () => {
  const CP = "ABB-83214";
  const BOOT = { chargePointVendor: "ACME", chargePointModel: "Wallbox9000" };
  const ALL_FOUR = "Energy.Active.Import.Register,Current.Import,Voltage," +
    "Power.Active.Import";

  const configRes = (sampled: string) => ({
    configurationKey: [
      { key: "MeterValuesSampledData", readonly: false, value: sampled },
    ],
  });

  const changeValues = (socket: FakeSocket): string[] =>
    callsTo(socket, "ChangeConfiguration")
      .map((frame) => frame[3] as { key: string; value: string })
      .filter((payload) => payload.key === "MeterValuesSampledData")
      .map((payload) => payload.value);

  it("narrows to the intersection of what we want and what it lists", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(
      socket,
      configRes("Energy.Active.Import.Register,Temperature"),
    );
    await answer(socket, { status: "Rejected" });
    // The re-read: its own value is the only list a 1.6 charger ever gives.
    await answer(
      socket,
      configRes("Energy.Active.Import.Register,Voltage,Temperature"),
    );
    await answer(socket, { status: "Accepted" });

    expect(changeValues(socket)).toEqual([
      ALL_FOUR,
      "Energy.Active.Import.Register,Voltage",
    ]);
  });

  it("does not re-offer a list identical to the one the charger already holds", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(socket, configRes("Energy.Active.Import.Register"));
    await answer(socket, { status: "Rejected" });
    await answer(socket, configRes("Energy.Active.Import.Register"));

    // Two writes here would be the same refused request sent twice.
    expect(changeValues(socket)).toHaveLength(1);
  });

  it("does not write to a read-only measurement list", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(socket, {
      configurationKey: [{
        key: "MeterValuesSampledData",
        readonly: true,
        value: "Energy.Active.Import.Register",
      }],
    });

    expect(callsTo(socket, "ChangeConfiguration")).toHaveLength(0);
  });

  it("treats an unknown key as final and does not retry on the next boot", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(socket, { unknownKey: ["MeterValuesSampledData"] });
    await call(socket, "BootNotification", BOOT);

    expect(callsTo(socket, "GetConfiguration")).toHaveLength(1);
  });

  it("rate-limits a flapping charger to one negotiation per reconnect burst", async () => {
    const { socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    await answer(socket, configRes("Energy.Active.Import.Register"));
    await answer(socket, { status: "Rejected" });
    await answer(socket, configRes("Energy.Active.Import.Register"));
    // A charger reconnecting every couple of seconds boots again immediately.
    await call(socket, "BootNotification", BOOT);
    await call(socket, "BootNotification", BOOT);

    // The two reads of the one negotiation, and nothing from the two boots
    // that followed it.
    expect(callsTo(socket, "GetConfiguration")).toHaveLength(2);
  });

  it("records a disconnect mid-negotiation instead of throwing", async () => {
    const { cs, socket } = attached(CP);

    await call(socket, "BootNotification", BOOT);
    // The charger drops while we are parked on its GetConfiguration answer.
    socket.onclose();
    // Awaiting the negotiator's rejection path to record the outcome.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cs.getData(CP).connected).toBe(false);
  });
});

describe("OCPP measurand negotiation — verifying against arriving data", () => {
  const CP = "ABB-83214";
  const BOOT = { chargePointVendor: "ACME", chargePointModel: "Wallbox9000" };

  // Boot, then answer as a charger that accepts everything we ask.
  const acceptEverything = async (socket: FakeSocket, status = "Accepted") => {
    await call(socket, "BootNotification", BOOT);
    await answer(socket, {
      configurationKey: [{
        key: "MeterValuesSampledData",
        readonly: false,
        value: "Energy.Active.Import.Register",
      }],
    });
    await answer(socket, { status });
  };

  it("says nothing about an idle charger that has sent no MeterValues", async () => {
    const { cs, socket } = attached(CP);

    await acceptEverything(socket);

    expect(cs.measurandWarning(CP)).toBeNull();
  });

  it("warns when readings arrive with no current in them", async () => {
    const { cs, socket } = attached(CP);
    await acceptEverything(socket);

    await meterValues(socket, [
      { measurand: "Energy.Active.Import.Register", value: "5000" },
    ]);

    expect(cs.measurandWarning(CP)).toContain("accepted");
  });

  it("stays quiet once current actually arrives, whatever the charger said", async () => {
    const { cs, socket } = attached(CP);
    await acceptEverything(socket);

    await meterValues(socket, [
      { measurand: "Current.Import", value: "16" },
      { measurand: "Energy.Active.Import.Register", value: "5000" },
    ]);

    expect(cs.measurandWarning(CP)).toBeNull();
  });

  it("warns about a stored-but-not-applied change without ever sending Reset", async () => {
    const { cs, socket } = attached(CP);
    await acceptEverything(socket, "RebootRequired");

    await meterValues(socket, [
      { measurand: "Energy.Active.Import.Register", value: "5000" },
    ]);

    expect(cs.measurandWarning(CP)).toContain("restart");
    // Rebooting a charger mid-transaction for better telemetry is not ours
    // to decide.
    expect(callsTo(socket, "Reset")).toHaveLength(0);
  });

  it("keeps two chargers' negotiations independent", async () => {
    const good = attached("charger-a");
    const bad = attached("charger-b");

    await acceptEverything(good.socket);
    await acceptEverything(bad.socket);
    await meterValues(good.socket, [{
      measurand: "Current.Import",
      value: "16",
    }]);
    await meterValues(bad.socket, [{
      measurand: "Energy.Active.Import.Register",
      value: "5000",
    }]);

    expect(good.cs.measurandWarning("charger-a")).toBeNull();
    expect(bad.cs.measurandWarning("charger-b")).not.toBeNull();
  });
});
