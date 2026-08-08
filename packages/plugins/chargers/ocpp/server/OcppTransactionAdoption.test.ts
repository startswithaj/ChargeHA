// A ChargeHA restart drops the socket mid-charge. The charger reconnects and
// keeps charging, but OCPP 1.6 gives no way to ask "what transaction are you
// on" — the only re-announcement is `transactionId` riding along on every
// in-transaction MeterValues (~once a minute). These tests drive that
// adoption path over a fake socket, the same way OcppPairing.test.ts drives
// the message handler rather than asserting on internal flags.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { OcppCentralSystem } from "./OcppCentralSystem.ts";

/** [messageTypeId, id, ...rest] — a decoded OCPP-J frame, in either
 *  direction (CALL out, CALLRESULT/CALLERROR in reply to a charger CALL). */
type Frame = [number, string, ...unknown[]];

describe("OCPP transaction adoption", () => {
  const CP = "ABB-83214";

  /** Minimal stand-in for the upgraded socket: records every frame we send
   *  (replies to charger CALLs, and our own outgoing CALLs) and lets a test
   *  push charger-initiated CALLs in. */
  const fakeSocket = () => {
    const sent: Frame[] = [];
    const socket = {
      sent,
      readyState: 1,
      close: () => {},
      send: (raw: string) => {
        sent.push(JSON.parse(raw) as Frame);
      },
      onmessage: (_e: { data: string }) => {},
      onclose: () => {},
      onerror: (_e: unknown) => {},
    };
    return socket;
  };

  /** A charge point with a charger row, already attached. */
  const attached = () => {
    const logger = new Logger("OcppTest", "error");
    const cs = new OcppCentralSystem(
      logger,
      new PluginDbLogger(() => Promise.resolve(), logger),
      () => Promise.resolve(true),
    );
    const socket = fakeSocket();
    cs.attach(socket as unknown as WebSocket, { chargerId: CP });
    return { cs, socket };
  };

  /** Deliver a charger-initiated CALL and return what we replied. */
  const call = async (
    socket: ReturnType<typeof fakeSocket>,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<Frame> => {
    const before = socket.sent.length;
    socket.onmessage({
      data: JSON.stringify([2, `id-${action}-${before}`, action, payload]),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return socket.sent[before];
  };

  const meterValues = (
    socket: ReturnType<typeof fakeSocket>,
    opts: { transactionId?: number; registerWh: number },
  ) =>
    call(socket, "MeterValues", {
      connectorId: 1,
      ...(opts.transactionId !== undefined
        ? { transactionId: opts.transactionId }
        : {}),
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{ value: String(opts.registerWh) }],
      }],
    });

  const startTransaction = (
    socket: ReturnType<typeof fakeSocket>,
    meterStart: number,
  ) =>
    call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart,
      timestamp: new Date().toISOString(),
    });

  it("adopts a transaction id from MeterValues when it has none", async () => {
    const { cs, socket } = attached();
    expect(cs.getData(CP).transactionId).toBeNull();

    await meterValues(socket, { transactionId: 7, registerWh: 5000 });

    expect(cs.getData(CP).transactionId).toBe(7);
  });

  it("baselines the adopted transaction at the register reading, and measures later energy from it", async () => {
    const { cs, socket } = attached();

    await meterValues(socket, { transactionId: 7, registerWh: 5000 });
    expect(cs.getData(CP).meterStartWh).toBe(5000);

    await meterValues(socket, { transactionId: 7, registerWh: 5300 });
    expect(cs.getData(CP).meterStartWh).toBe(5000);
    expect(cs.getData(CP).energyRegisterWh).toBe(5300);
  });

  it("does not overwrite an existing StartTransaction baseline", async () => {
    const { cs, socket } = attached();

    await startTransaction(socket, 2000);
    expect(cs.getData(CP).meterStartWh).toBe(2000);

    // A mismatched id reaching us here is exactly the reconnect case adoption
    // exists for — the baseline must stay the one StartTransaction gave us.
    await meterValues(socket, { transactionId: 99, registerWh: 9000 });

    expect(cs.getData(CP).transactionId).toBe(99);
    expect(cs.getData(CP).meterStartWh).toBe(2000);
  });

  it("changes nothing and does not throw when MeterValues carries no transactionId", async () => {
    const { cs, socket } = attached();

    const reply = await meterValues(socket, { registerWh: 4000 });

    expect(reply[0]).toBe(3); // CALLRESULT, not a CALLERROR
    expect(cs.getData(CP).transactionId).toBeNull();
    expect(cs.getData(CP).energyRegisterWh).toBe(4000);
  });

  it("scales a kWh energy register to Wh — OCPP allows either unit", async () => {
    const { cs, socket } = attached();

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
    const { cs, socket } = attached();

    await meterValues(socket, { transactionId: 7, registerWh: 5000 });
    expect(cs.getData(CP).transactionId).toBe(7);

    const reply = await startTransaction(socket, 6000);

    expect((reply[2] as { transactionId: number }).transactionId).toBe(8);
  });

  it("remoteStop with no transaction id sends a 0A ChargePointMaxProfile on connectorId 0 and resolves true when accepted", async () => {
    const { cs, socket } = attached();
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
    const { cs, socket } = attached();
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
