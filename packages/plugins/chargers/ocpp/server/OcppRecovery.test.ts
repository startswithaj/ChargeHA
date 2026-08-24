import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { answer, attached, call, callsTo } from "./test-helpers/ocppHarness.ts";

describe("OCPP connection recovery", () => {
  const CP = "MG-10407939";

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("clears cached transaction state, wipes profiles, and asks the charger to restate itself", async () => {
    const { cs, socket } = attached(CP);
    await call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart: 100,
      timestamp: new Date().toISOString(),
    });
    expect(cs.getData(CP).transactionId).toBe(1);

    const pending = cs.recoverConnection(CP);
    await tick();
    expect(cs.getData(CP).transactionId).toBeNull();

    await answer(socket, { status: "Accepted" });
    await answer(socket, { status: "Accepted" });
    await answer(socket, { status: "Accepted" });
    await pending;

    expect(callsTo(socket, "ClearChargingProfile").length).toBe(1);
    expect(callsTo(socket, "TriggerMessage").length).toBe(2);
  });

  it("keeps going when TriggerMessage is not implemented by the charger", async () => {
    const { cs, socket } = attached(CP);

    const pending = cs.recoverConnection(CP);
    await tick();
    await answer(socket, { status: "Accepted" });

    const outgoing = socket.sent.filter((f) => f[0] === 2).at(-1)!;
    socket.onmessage({
      data: JSON.stringify([4, outgoing[1], "NotImplemented", "", {}]),
    });
    await tick();
    await answer(socket, { status: "Accepted" });

    const steps = await pending;
    expect(steps.length).toBe(4);
    expect(callsTo(socket, "TriggerMessage").length).toBe(2);
  });

  it("softReset sends Reset type Soft and resolves on acceptance", async () => {
    const { cs, socket } = attached(CP);

    const pending = cs.softReset(CP);
    await tick();
    const [frame] = callsTo(socket, "Reset");
    expect(frame[3]).toEqual({ type: "Soft" });

    await answer(socket, { status: "Accepted" });
    expect(await pending).toBe(true);
  });
});
