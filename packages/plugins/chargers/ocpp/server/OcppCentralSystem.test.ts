import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { OcppCentralSystem } from "./OcppCentralSystem.ts";
import {
  answer,
  attached,
  call,
  callsTo,
  type FakeSocket,
  fakeSocket,
  meterValues as sendMeterValues,
} from "./test-helpers/ocppHarness.ts";
import { chargingProfilePayload } from "./OcppMessages.ts";
// A ChargeHA restart drops the socket mid-charge. The charger reconnects and
// keeps charging, but OCPP 1.6 gives no way to ask "what transaction are you
// on" — the only re-announcement is `transactionId` riding along on every
// in-transaction MeterValues (~once a minute). These tests exercise that
// adoption path over a fake socket, the same way OcppPairing.test.ts exercises
// the message handler rather than asserting on internal flags.

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

  it("keeps connector 1's status when a charge-point-level (connectorId 0) StatusNotification arrives", async () => {
    const { cs, socket } = attached(CP);

    await call(socket, "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Charging",
    });
    await call(socket, "StatusNotification", {
      connectorId: 0,
      errorCode: "NoError",
      status: "Available",
    });

    expect(cs.getData(CP).status).toBe("Charging");

    await call(socket, "StatusNotification", {
      connectorId: 0,
      errorCode: "OtherError",
      status: "Faulted",
    });

    expect(cs.getData(CP).status).toBe("Charging");
    expect(cs.getData(CP).errorCode).toBe("OtherError");
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

describe("OCPP command rejection detail", () => {
  const CP = "MG-10407939";

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Attaches handlers immediately so a rejection settling between answer
  // ticks never surfaces as an unhandled promise rejection.
  const settle = (p: Promise<unknown>): Promise<Error | "resolved"> =>
    p.then(() => "resolved" as const, (e: Error) => e);

  const answerFrame = async (
    socket: FakeSocket,
    callId: string,
    payload: Record<string, unknown>,
  ) => {
    socket.onmessage({ data: JSON.stringify([3, callId, payload]) });
    await tick();
  };

  const statusNotification = (
    socket: FakeSocket,
    payload: Record<string, unknown>,
  ) =>
    call(socket, "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Finishing",
      ...payload,
    });

  it("names each profile's status and the charger's own status when SetChargingProfile is refused", async () => {
    const { cs, socket } = attached(CP);
    await statusNotification(socket, {});

    const pending = settle(cs.setChargingProfiles(CP, [
      chargingProfilePayload("ChargePointMaxProfile", 32),
      chargingProfilePayload("TxDefaultProfile", 32),
    ]));
    await answer(socket, { status: "Accepted" });
    await answer(socket, { status: "Rejected" });

    const outcome = await pending;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe(
      "SetChargingProfile not accepted: ChargePointMaxProfile=Accepted, " +
        "TxDefaultProfile=Rejected (charger status Finishing)",
    );
  });

  it("carries the vendor error fields from the last StatusNotification", async () => {
    const { cs, socket } = attached(CP);
    await statusNotification(socket, {
      status: "Faulted",
      errorCode: "OtherError",
      vendorErrorCode: "E42",
      info: "Overtemperature",
    });

    const pending = settle(cs.setChargingProfiles(CP, [
      chargingProfilePayload("ChargePointMaxProfile", 32),
    ]));
    const [first] = callsTo(socket, "SetChargingProfile");
    await answerFrame(socket, first[1], { status: "Rejected" });

    const outcome = await pending;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(
      "(charger status Faulted OtherError/E42: Overtemperature)",
    );
  });

  it("rejects remoteStart with the charger's response status", async () => {
    const { cs, socket } = attached(CP);

    const pending = settle(cs.remoteStart(CP));
    const [first] = callsTo(socket, "RemoteStartTransaction");
    await answerFrame(socket, first[1], { status: "Rejected" });

    const outcome = await pending;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(
      "RemoteStartTransaction not accepted: Rejected",
    );
  });

  it("resolves true when only the TxProfile tier is rejected — Max and TxDefault already steer the charger", async () => {
    const { cs, socket } = attached(CP);

    const pending = settle(cs.setChargingProfiles(CP, [
      chargingProfilePayload("ChargePointMaxProfile", 8),
      chargingProfilePayload("TxDefaultProfile", 8),
      chargingProfilePayload("TxProfile", 8, 1),
    ]));
    await tick();
    await answer(socket, { status: "Accepted" });
    await answer(socket, { status: "Accepted" });
    await answer(socket, { status: "Rejected" });

    expect(await pending).toBe("resolved");
  });

  it("still throws when an authoritative tier is rejected", async () => {
    const { cs, socket } = attached(CP);

    const pending = settle(cs.setChargingProfiles(CP, [
      chargingProfilePayload("ChargePointMaxProfile", 8),
      chargingProfilePayload("TxDefaultProfile", 8),
    ]));
    await tick();
    await answer(socket, { status: "Accepted" });
    await answer(socket, { status: "Rejected" });

    const outcome = await pending;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(
      "SetChargingProfile not accepted",
    );
  });

  it("remoteStart with amps embeds a Relative TxProfile in the request", async () => {
    const { cs, socket } = attached(CP);

    const pending = settle(cs.remoteStart(CP, 9));
    await tick();
    const [frame] = callsTo(socket, "RemoteStartTransaction");
    const req = frame[3] as {
      chargingProfile: {
        chargingProfilePurpose: string;
        chargingProfileKind: string;
        chargingSchedule: { chargingSchedulePeriod: { limit: number }[] };
      };
    };
    expect(req.chargingProfile.chargingProfilePurpose).toBe("TxProfile");
    expect(req.chargingProfile.chargingProfileKind).toBe("Relative");
    expect(
      req.chargingProfile.chargingSchedule.chargingSchedulePeriod[0].limit,
    ).toBe(9);

    await answer(socket, { status: "Accepted" });
    expect(await pending).toBe("resolved");
  });

  it("still resolves true when everything is accepted", async () => {
    const { cs, socket } = attached(CP);

    const pending = settle(cs.setChargingProfiles(CP, [
      chargingProfilePayload("ChargePointMaxProfile", 7),
      chargingProfilePayload("TxDefaultProfile", 7),
    ]));
    await answer(socket, { status: "Accepted" });
    await answer(socket, { status: "Accepted" });

    expect(await pending).toBe("resolved");
  });
});

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

describe("OCPP message ordering", () => {
  const CP = "ABB-83214";

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const startTransactionFrame = (id: string, meterStart: number) =>
    JSON.stringify([2, id, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart,
      timestamp: new Date().toISOString(),
    }]);

  const meterValuesFrame = (
    id: string,
    transactionId: number,
    registerWh: number,
  ) =>
    JSON.stringify([2, id, "MeterValues", {
      connectorId: 1,
      transactionId,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{
          value: String(registerWh),
          measurand: "Energy.Active.Import.Register",
        }],
      }],
    }]);

  const heartbeatFrame = (id: string) =>
    JSON.stringify([2, id, "Heartbeat", {}]);

  // A hasChargerRow stub whose FIRST call hangs until `release()` is called;
  // every call after resolves immediately. Reproduces the DB-latency
  // asymmetry from the bug report deterministically rather than by timing.
  const blockingFirstLookup = () => {
    const resolver = { release: () => {} };
    const first = new Promise<boolean>((resolve) => {
      resolver.release = () => resolve(true);
    });
    const calls = { count: 0 };
    return {
      hasChargerRow: (): Promise<boolean> => {
        calls.count++;
        return calls.count === 1 ? first : Promise.resolve(true);
      },
      release: () => resolver.release(),
    };
  };

  it("finishes StartTransaction before a MeterValues that arrived right behind it, even when StartTransaction's row lookup is the slower one", async () => {
    const { hasChargerRow, release: releaseStart } = blockingFirstLookup();
    const { cs, socket } = attached(CP, { hasChargerRow });

    // Both frames arrive back to back, in correct wire order — exactly what
    // a charger does: StartTransaction, then (moments later) a MeterValues
    // carrying the transaction id it was told to use.
    socket.onmessage({ data: startTransactionFrame("id-start", 1500) });
    socket.onmessage({ data: meterValuesFrame("id-mv", 1, 9000) });

    // StartTransaction is still parked on its row lookup. Without the queue,
    // MeterValues's own (fast-resolving) lookup would already have let it
    // run and adopt a baseline from its 9000 register reading.
    await tick();
    expect(cs.getData(CP).meterStartWh).toBeNull();
    expect(socket.sent.length).toBe(0);

    releaseStart();
    await tick();

    // StartTransaction's own baseline wins — the MeterValues register
    // reading never got a chance to become the baseline.
    expect(cs.getData(CP).meterStartWh).toBe(1500);
    expect(socket.sent[0][2]).toEqual({
      transactionId: 1,
      idTagInfo: { status: "Accepted" },
    });
  });

  it("responds with a CALLERROR instead of dropping a message once a charge point's queue is full", async () => {
    // Every row lookup hangs forever — the simplest way to fill the bound
    // without timing games: nothing ever finishes, so nothing ever drains.
    const hasChargerRow = () => new Promise<boolean>(() => {});
    const { socket } = attached(CP, { hasChargerRow });

    Array.from({ length: 64 }, (_, i) => i).forEach((i) => {
      socket.onmessage({ data: heartbeatFrame(`fill-${i}`) });
    });
    await tick();
    expect(socket.sent.length).toBe(0); // all 64 are queued/running, none answered

    socket.onmessage({ data: heartbeatFrame("overflow") });
    await tick();

    expect(socket.sent.length).toBe(1);
    const [messageTypeId, id, code] = socket.sent[0];
    expect(messageTypeId).toBe(4); // CALLERROR, not a silent drop
    expect(id).toBe("overflow");
    expect(code).toBe("InternalError");
  });

  it("sends outgoing CALLs one at a time — the next only after the previous CALLRESULT", async () => {
    const { cs, socket } = attached(CP);

    // OCPP-J permits one outstanding CALL per direction; chargers drop or
    // misorder overlapping CALLs.
    const pending = cs.setChargingProfiles(CP, [
      chargingProfilePayload("ChargePointMaxProfile", 10),
      chargingProfilePayload("TxDefaultProfile", 10),
    ]).catch(() => false);
    await tick();

    expect(callsTo(socket, "SetChargingProfile").length).toBe(1);

    await answer(socket, { status: "Accepted" });
    expect(callsTo(socket, "SetChargingProfile").length).toBe(2);

    await answer(socket, { status: "Accepted" });
    expect(await pending).toBe(true);
  });

  it("drops a handler still queued against a socket a reconnect already replaced", async () => {
    const { hasChargerRow, release: releaseFirst } = blockingFirstLookup();
    const { cs, socket: oldSocket } = attached(CP, { hasChargerRow });

    // Heartbeat blocks the queue on its row lookup; StartTransaction queues
    // up right behind it, on the same (soon to be stale) connection.
    oldSocket.onmessage({ data: heartbeatFrame("id-hb") });
    oldSocket.onmessage({ data: startTransactionFrame("id-start", 1000) });
    await tick();

    // The charger reconnects before the Heartbeat's lookup ever resolves —
    // attach() replaces the connection (and its queue) wholesale.
    const newSocket = fakeSocket();
    cs.attach(newSocket as unknown as WebSocket, { chargerId: CP });

    releaseFirst();
    await tick();

    // The queued StartTransaction belonged to the old connection and must be
    // dropped, not applied to the new connection's state.
    expect(cs.getData(CP).transactionId).toBeNull();
    // Heartbeat had already passed the guard and started running (and
    // reply() captures the socket to answer on up front) before the
    // reconnect happened, so its own reply still lands on the old socket —
    // that part is unrelated to this guard. What the guard proves is that
    // NOTHING from this stale backlog reaches the new connection.
    expect(oldSocket.sent.length).toBe(1);
    expect(newSocket.sent.length).toBe(0);
  });
});

interface SentFrame {
  messageTypeId: number;
  id: string;
  payloadOrCode: unknown;
}

describe("OCPP pairing", () => {
  // Minimal stand-in for the upgraded socket: records what we send back and
  // lets a test push charger-initiated CALLs in.
  const fakeSocket = () => {
    const sent: SentFrame[] = [];
    const socket = {
      sent,
      readyState: 1,
      close: () => {},
      send: (raw: string) => {
        const [messageTypeId, id, payloadOrCode] = JSON.parse(raw);
        sent.push({ messageTypeId, id, payloadOrCode });
      },
      onmessage: (_e: { data: string }) => {},
      onclose: () => {},
      onerror: (_e: unknown) => {},
    };
    return socket;
  };

  // A fake row lookup: which charge point ids currently have a charger row.
  // A test can add to it mid-flow to simulate Save creating a row on an
  // already-open socket.
  const build = (rowsFor: Set<string> = new Set()) => {
    const logger = new Logger("OcppTest", "error");
    const cs = new OcppCentralSystem(
      logger,
      new PluginDbLogger(() => Promise.resolve(), logger),
      (chargePointId) => Promise.resolve(rowsFor.has(chargePointId)),
    );
    return { cs, rowsFor };
  };

  // Deliver a charger-initiated CALL and return what we replied. Message
  // handling is async now (the row lookup is), so tests await a tick.
  const call = async (
    socket: ReturnType<typeof fakeSocket>,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<SentFrame> => {
    const before = socket.sent.length;
    socket.onmessage({
      data: JSON.stringify([2, `id-${action}`, action, payload]),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return socket.sent[before];
  };

  const BOOT = { chargePointVendor: "ACME", chargePointModel: "Wallbox9000" };
  const CP = "ABB-83214";

  it("is closed until armed, so an unknown charger is refused", () => {
    const { cs } = build();
    expect(cs.acceptsPairing()).toBe(false);
  });

  it("accepts a charger while armed and records the id it announced", () => {
    const { cs } = build();
    cs.armPairing(60_000);
    expect(cs.acceptsPairing()).toBe(true);

    const socket = fakeSocket();
    cs.notePairedCharger(CP);
    cs.attach(socket as unknown as WebSocket, { chargerId: CP });

    expect(cs.getData(CP).connected).toBe(true);
    expect(cs.pairingState().seen.map((c) => c.chargerId)).toEqual([CP]);
  });

  it("surfaces vendor and model from BootNotification even with no charger row", async () => {
    const { cs } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.notePairedCharger(CP);
    cs.attach(socket as unknown as WebSocket, { chargerId: CP });

    const reply = await call(socket, "BootNotification", BOOT);

    expect(reply.messageTypeId).toBe(3); // CALLRESULT
    expect((reply.payloadOrCode as { status: string }).status).toBe("Accepted");
    expect(cs.pairingState().seen[0].info?.vendor).toBe("ACME");
    expect(cs.pairingState().seen[0].info?.model).toBe("Wallbox9000");
  });

  it("refuses StartTransaction from an id with no charger row", async () => {
    const { cs } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.attach(socket as unknown as WebSocket, { chargerId: CP });

    const reply = await call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart: 1000,
      timestamp: new Date().toISOString(),
    });

    expect(reply.messageTypeId).toBe(4); // CALLERROR, not a silent drop
    expect(reply.payloadOrCode).toBe("NotImplemented");
    expect(cs.getData(CP).transactionId).toBeNull();
  });

  it("refuses MeterValues from an id with no charger row", async () => {
    const { cs } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.attach(socket as unknown as WebSocket, { chargerId: CP });

    const reply = await call(socket, "MeterValues", {
      connectorId: 1,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{ value: "7000", measurand: "Power.Active.Import" }],
      }],
    });

    expect(reply.messageTypeId).toBe(4);
    expect(cs.getData(CP).powerW).toBeNull();
  });

  it("refuses Heartbeat and StatusNotification too — only BootNotification is excepted", async () => {
    const { cs } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.attach(socket as unknown as WebSocket, { chargerId: CP });

    const heartbeat = await call(socket, "Heartbeat", {});
    expect(heartbeat.messageTypeId).toBe(4);

    const status = await call(socket, "StatusNotification", {
      connectorId: 1,
      status: "Available",
      errorCode: "NoError",
    });
    expect(status.messageTypeId).toBe(4);
  });

  it("handles the same calls normally once a charger row exists — no reconnect needed", async () => {
    const { cs, rowsFor } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.notePairedCharger(CP);
    cs.attach(socket as unknown as WebSocket, { chargerId: CP });

    // The user saved the row on the wizard/settings side — the already-open
    // socket's next message must be handled normally, no reconnect.
    rowsFor.add(CP);

    const reply = await call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart: 1000,
      timestamp: new Date().toISOString(),
    });

    expect(reply.messageTypeId).toBe(3);
    expect(cs.getData(CP).transactionId).not.toBeNull();
  });

  it("keeps two chargers independent — ids, state and disconnects", async () => {
    const { cs, rowsFor } = build();
    rowsFor.add("charger-a");
    rowsFor.add("charger-b");
    cs.armPairing(60_000);
    const a = fakeSocket();
    const b = fakeSocket();
    cs.notePairedCharger("charger-a");
    cs.attach(a as unknown as WebSocket, { chargerId: "charger-a" });
    cs.notePairedCharger("charger-b");
    cs.attach(b as unknown as WebSocket, { chargerId: "charger-b" });

    // Attaching the second must not evict the first — that was the bug.
    expect(cs.getData("charger-a").connected).toBe(true);
    expect(cs.getData("charger-b").connected).toBe(true);

    const startTx = (socket: ReturnType<typeof fakeSocket>) =>
      call(socket, "StartTransaction", {
        connectorId: 1,
        idTag: "tag",
        meterStart: 1000,
        timestamp: new Date().toISOString(),
      });
    await startTx(a);
    await startTx(b);

    // Separate counters: a shared one would give the second charger id 2.
    expect(cs.getData("charger-a").transactionId).toBe(1);
    expect(cs.getData("charger-b").transactionId).toBe(1);

    // One disconnecting leaves the other alone.
    a.onclose();
    expect(cs.getData("charger-a").connected).toBe(false);
    expect(cs.getData("charger-b").connected).toBe(true);
  });

  it("reports the window closed once it has expired", () => {
    const { cs } = build();
    cs.armPairing(-1); // already past its deadline
    expect(cs.pairingState().armed).toBe(false);
    expect(cs.acceptsPairing()).toBe(false);
  });

  it("cancelling closes sockets with no charger row and leaves adopted ones alone", async () => {
    const { cs, rowsFor } = build();
    rowsFor.add("charger-adopted");
    cs.armPairing(60_000);
    const pairingOnly = fakeSocket();
    const adopted = fakeSocket();
    let pairingClosed = false;
    let adoptedClosed = false;
    pairingOnly.close = () => {
      pairingClosed = true;
    };
    adopted.close = () => {
      adoptedClosed = true;
    };
    cs.attach(pairingOnly as unknown as WebSocket, { chargerId: CP });
    cs.attach(adopted as unknown as WebSocket, {
      chargerId: "charger-adopted",
    });

    await cs.cancelPairing();

    expect(cs.acceptsPairing()).toBe(false);
    expect(pairingClosed).toBe(true);
    expect(adoptedClosed).toBe(false);
  });
});
