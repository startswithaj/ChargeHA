// onMessage() used to call reply() without awaiting it, so two CALLs that
// arrived in correct wire order could finish their state mutations in either
// order — whichever one's charger-row lookup (hasChargerRow, a DB round
// trip) happened to come back first. A MeterValues racing ahead of the
// StartTransaction it followed would then baseline meterStartWh from the
// wrong reading, permanently. These tests drive that race directly, over the
// real message handler and a controllable row lookup, the same way
// OcppTransactionAdoption.test.ts and OcppPairing.test.ts drive the handler
// rather than asserting on internal flags.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { attached, fakeSocket } from "./test-helpers/ocppHarness.ts";

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
