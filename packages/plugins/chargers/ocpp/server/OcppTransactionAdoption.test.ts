// A ChargeHA restart drops the socket mid-charge. The charger reconnects and
// keeps charging, but OCPP 1.6 gives no way to ask "what transaction are you
// on" — the only re-announcement is `transactionId` riding along on every
// in-transaction MeterValues (~once a minute). These tests exercise that
// adoption path over a fake socket, the same way OcppPairing.test.ts exercises
// the message handler rather than asserting on internal flags.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  attached,
  call,
  type FakeSocket,
  meterValues as sendMeterValues,
} from "./test-helpers/ocppHarness.ts";

describe("OCPP transaction adoption", () => {
  const CP = "ABB-83214";

  const meterValues = (
    socket: FakeSocket,
    opts: { transactionId?: number; registerWh: number },
  ) =>
    sendMeterValues(socket, [{ value: String(opts.registerWh) }], {
      transactionId: opts.transactionId,
    });

  const startTransaction = (socket: FakeSocket, meterStart: number) =>
    call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart,
      timestamp: new Date().toISOString(),
    });

  it("adopts a transaction id from MeterValues when it has none", async () => {
    const { cs, socket } = attached(CP);
    expect(cs.getData(CP).transactionId).toBeNull();

    await meterValues(socket, { transactionId: 7, registerWh: 5000 });

    expect(cs.getData(CP).transactionId).toBe(7);
  });

  it("baselines the adopted transaction at the register reading, and measures later energy from it", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(socket, { transactionId: 7, registerWh: 5000 });
    expect(cs.getData(CP).meterStartWh).toBe(5000);

    await meterValues(socket, { transactionId: 7, registerWh: 5300 });
    expect(cs.getData(CP).meterStartWh).toBe(5000);
    expect(cs.getData(CP).energyRegisterWh).toBe(5300);
  });

  it("does not overwrite an existing StartTransaction baseline", async () => {
    const { cs, socket } = attached(CP);

    await startTransaction(socket, 2000);
    expect(cs.getData(CP).meterStartWh).toBe(2000);

    // A mismatched id reaching us here is exactly the reconnect case adoption
    // exists for — the baseline must stay the one StartTransaction gave us.
    await meterValues(socket, { transactionId: 99, registerWh: 9000 });

    expect(cs.getData(CP).transactionId).toBe(99);
    expect(cs.getData(CP).meterStartWh).toBe(2000);
  });

  it("changes nothing and does not throw when MeterValues carries no transactionId", async () => {
    const { cs, socket } = attached(CP);

    const reply = await meterValues(socket, { registerWh: 4000 });

    expect(reply[0]).toBe(3); // CALLRESULT, not a CALLERROR
    expect(cs.getData(CP).transactionId).toBeNull();
    expect(cs.getData(CP).energyRegisterWh).toBe(4000);
  });

  it("scales a kWh energy register to Wh — OCPP allows either unit", async () => {
    const { cs, socket } = attached(CP);

    // Raw call rather than the meterValues helper: the point of this test is
    // the unit field, which the helper deliberately omits.
    await call(socket, "MeterValues", {
      connectorId: 1,
      transactionId: 7,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{
          value: "1.5",
          measurand: "Energy.Active.Import.Register",
          unit: "kWh",
        }],
      }],
    });

    expect(cs.getData(CP).energyRegisterWh).toBe(1500);
  });

  it("keeps the transaction counter ahead of an adopted id — the next StartTransaction returns 8", async () => {
    const { cs, socket } = attached(CP);

    await meterValues(socket, { transactionId: 7, registerWh: 5000 });
    expect(cs.getData(CP).transactionId).toBe(7);

    const reply = await startTransaction(socket, 6000);

    expect((reply[2] as { transactionId: number }).transactionId).toBe(8);
  });

  it("does not re-adopt a transaction after its StopTransaction — trailing MeterValues must not resurrect it", async () => {
    const { cs, socket } = attached(CP);
    await startTransaction(socket, 1000);
    expect(cs.getData(CP).transactionId).toBe(1);

    // StarCharge (and most chargers) flush 1-2 final transaction-scoped
    // MeterValues after StopTransaction; adopting that id resurrects a dead
    // transaction (the 22 Aug incident).
    await call(socket, "StopTransaction", {
      transactionId: 1,
      meterStop: 1500,
      timestamp: new Date().toISOString(),
      idTag: "tag",
      reason: "Remote",
    });
    expect(cs.getData(CP).transactionId).toBeNull();

    await meterValues(socket, { transactionId: 1, registerWh: 1500 });

    expect(cs.getData(CP).transactionId).toBeNull();
    expect(cs.getData(CP).meterStartWh).toBeNull();
  });

  it("refuses adoption while the charger reports Finishing or Available — no transaction can be running", async () => {
    const { cs, socket } = attached(CP);

    await call(socket, "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Finishing",
    });
    await meterValues(socket, { transactionId: 5, registerWh: 3000 });
    expect(cs.getData(CP).transactionId).toBeNull();

    await call(socket, "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Available",
    });
    await meterValues(socket, { transactionId: 5, registerWh: 3000 });
    expect(cs.getData(CP).transactionId).toBeNull();

    // Charging status is the reconnect case adoption exists for.
    await call(socket, "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Charging",
    });
    await meterValues(socket, { transactionId: 5, registerWh: 3100 });
    expect(cs.getData(CP).transactionId).toBe(5);
  });

  it("ignores a replayed StopTransaction for a different transaction id", async () => {
    const { cs, socket } = attached(CP);
    await startTransaction(socket, 1000);
    await call(socket, "StopTransaction", {
      transactionId: 1,
      meterStop: 1500,
      timestamp: new Date().toISOString(),
    });
    await call(socket, "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Charging",
    });
    await startTransaction(socket, 2000);
    expect(cs.getData(CP).transactionId).toBe(2);

    // OCPP 1.6 replays queued offline messages after reconnect — a stale stop
    // for transaction 1 can arrive while transaction 2 is live.
    await call(socket, "StopTransaction", {
      transactionId: 1,
      meterStop: 1500,
      timestamp: new Date().toISOString(),
    });

    expect(cs.getData(CP).transactionId).toBe(2);
    expect(cs.getData(CP).meterStartWh).toBe(2000);
  });

  it("remoteStop with no transaction id sends a 0A ChargePointMaxProfile on connectorId 0 and resolves true when accepted", async () => {
    const { cs, socket } = attached(CP);
    expect(cs.getData(CP).transactionId).toBeNull();

    const before = socket.sent.length;
    const result = cs.remoteStop(CP);

    const [messageTypeId, id, action, payload] = socket.sent[before];
    expect(messageTypeId).toBe(2); // CALL
    expect(action).toBe("SetChargingProfile");
    const profile = payload as {
      connectorId: number;
      csChargingProfiles: {
        chargingSchedule: { chargingSchedulePeriod: { limit: number }[] };
      };
    };
    expect(profile.connectorId).toBe(0);
    expect(
      profile.csChargingProfiles.chargingSchedule.chargingSchedulePeriod[0]
        .limit,
    ).toBe(0);

    socket.onmessage({
      data: JSON.stringify([3, id, { status: "Accepted" }]),
    });

    expect(await result).toBe(true);
  });

  it("remoteStop with a transaction id still sends RemoteStopTransaction (happy-path regression guard)", async () => {
    const { cs, socket } = attached(CP);
    await startTransaction(socket, 1000);

    const before = socket.sent.length;
    const result = cs.remoteStop(CP);

    const [messageTypeId, id, action, payload] = socket.sent[before];
    expect(messageTypeId).toBe(2);
    expect(action).toBe("RemoteStopTransaction");
    expect((payload as { transactionId: number }).transactionId).toBe(1);

    socket.onmessage({
      data: JSON.stringify([3, id, { status: "Accepted" }]),
    });

    expect(await result).toBe(true);
  });
});
