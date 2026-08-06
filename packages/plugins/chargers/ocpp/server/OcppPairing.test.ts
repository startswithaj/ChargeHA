// Pairing exists to break a deadlock in first-time setup: the websocket route
// rejects any charge point id that is not the configured one, but the user
// cannot know the URL and id are right until a charger actually connects. A
// pairing window accepts an unknown id for a few minutes so the panel can
// prove reachability before anything is committed.
//
// The load-bearing property is that a paired-but-unadopted charger is inert.
// It may say what it is and that it is alive; it may not open a transaction or
// push meter readings, because no user has yet agreed that this charger is
// theirs. These tests drive the real message handler over a fake socket rather
// than asserting on internal flags, so a regression that lets StartTransaction
// through fails here rather than in production.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { OcppCentralSystem } from "./OcppCentralSystem.ts";

interface SentFrame {
  messageTypeId: number;
  id: string;
  payloadOrCode: unknown;
}

describe("OCPP pairing", () => {
  /** Minimal stand-in for the upgraded socket: records what we send back and
   *  lets a test push charger-initiated CALLs in. */
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

  const build = () => {
    const persisted: Array<unknown> = [];
    const logger = new Logger("OcppTest", "error");
    const cs = new OcppCentralSystem(
      logger,
      new PluginDbLogger(() => Promise.resolve(), logger),
      (tx) => {
        persisted.push(tx);
        return Promise.resolve();
      },
    );
    return { cs, persisted };
  };

  /** Deliver a charger-initiated CALL and return what we replied. */
  const call = (
    socket: ReturnType<typeof fakeSocket>,
    action: string,
    payload: Record<string, unknown>,
  ): SentFrame => {
    const before = socket.sent.length;
    socket.onmessage({
      data: JSON.stringify([2, `id-${action}`, action, payload]),
    });
    return socket.sent[before];
  };

  const BOOT = { chargePointVendor: "ACME", chargePointModel: "Wallbox9000" };

  it("is closed until armed, so an unknown charger is refused", () => {
    const { cs } = build();
    expect(cs.acceptsPairing()).toBe(false);
  });

  it("accepts a charger while armed and records the id it announced", () => {
    const { cs } = build();
    cs.armPairing(60_000);
    expect(cs.acceptsPairing()).toBe(true);

    const socket = fakeSocket();
    cs.notePairedCharger("ABB-83214");
    cs.attach(socket as unknown as WebSocket, { provisional: true });

    expect(cs.getData().connected).toBe(true);
    expect(cs.getData().provisional).toBe(true);
    expect(cs.pairingState().announcedId).toBe("ABB-83214");
  });

  it("surfaces vendor and model from BootNotification for the panel", () => {
    const { cs } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.notePairedCharger("ABB-83214");
    cs.attach(socket as unknown as WebSocket, { provisional: true });

    const reply = call(socket, "BootNotification", BOOT);

    expect(reply.messageTypeId).toBe(3); // CALLRESULT
    expect((reply.payloadOrCode as { status: string }).status).toBe("Accepted");
    expect(cs.pairingState().info?.vendor).toBe("ACME");
    expect(cs.pairingState().info?.model).toBe("Wallbox9000");
  });

  it("refuses StartTransaction from an unadopted charger and persists nothing", () => {
    const { cs, persisted } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.attach(socket as unknown as WebSocket, { provisional: true });

    const reply = call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart: 1000,
      timestamp: new Date().toISOString(),
    });

    expect(reply.messageTypeId).toBe(4); // CALLERROR, not a silent drop
    expect(reply.payloadOrCode).toBe("NotImplemented");
    expect(cs.getData().transactionId).toBeNull();
    expect(persisted).toEqual([]);
  });

  it("refuses MeterValues from an unadopted charger", () => {
    const { cs } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.attach(socket as unknown as WebSocket, { provisional: true });

    const reply = call(socket, "MeterValues", {
      connectorId: 1,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{ value: "7000", measurand: "Power.Active.Import" }],
      }],
    });

    expect(reply.messageTypeId).toBe(4);
    expect(cs.getData().powerW).toBeNull();
  });

  it("accepts the same calls once the charger is adopted", () => {
    const { cs, persisted } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.notePairedCharger("ABB-83214");
    cs.attach(socket as unknown as WebSocket, { provisional: true });

    cs.promotePairing();

    expect(cs.getData().provisional).toBe(false);
    expect(cs.pairingState().armed).toBe(false);

    const reply = call(socket, "StartTransaction", {
      connectorId: 1,
      idTag: "tag",
      meterStart: 1000,
      timestamp: new Date().toISOString(),
    });

    expect(reply.messageTypeId).toBe(3);
    expect(cs.getData().transactionId).not.toBeNull();
    expect(persisted.length).toBe(1);
  });

  it("reports the window closed once it has expired", () => {
    const { cs } = build();
    cs.armPairing(-1); // already past its deadline
    expect(cs.pairingState().armed).toBe(false);
    expect(cs.acceptsPairing()).toBe(false);
  });

  it("clears provisional when the charger disconnects", () => {
    const { cs } = build();
    cs.armPairing(60_000);
    const socket = fakeSocket();
    cs.attach(socket as unknown as WebSocket, { provisional: true });
    expect(cs.getData().provisional).toBe(true);

    socket.onclose();

    // A disconnected charger reporting itself as mid-pairing would leave the
    // panel showing a charger that is no longer there.
    expect(cs.getData().connected).toBe(false);
    expect(cs.getData().provisional).toBe(false);
  });

  it("cancelling closes the window", () => {
    const { cs } = build();
    cs.armPairing(60_000);
    cs.cancelPairing();
    expect(cs.acceptsPairing()).toBe(false);
  });
});
