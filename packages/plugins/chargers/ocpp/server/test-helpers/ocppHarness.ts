// Shared fixtures for the OCPP central-system tests. Everything here is a
// factory: each call builds fresh state, so no suite can leak into another.
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { OcppCentralSystem } from "../OcppCentralSystem.ts";

// [messageTypeId, id, ...rest] — a decoded OCPP-J frame, in either direction
// (CALL out, CALLRESULT/CALLERROR in reply to a charger CALL).
export type Frame = [number, string, ...unknown[]];

// Minimal stand-in for the upgraded socket: records every frame we send
// (replies to charger CALLs, and our own outgoing CALLs) and lets a test
// push charger-initiated CALLs in.
export const fakeSocket = () => {
  const sent: Frame[] = [];
  return {
    sent,
    readyState: 1,
    close: () => {},
    send: (raw: string) => {
      sent.push(JSON.parse(raw) as Frame);
    },
    // Placeholders with the real signatures — attach() replaces them, and
    // tests call onmessage directly to push a charger CALL in.
    onmessage: (event: { data: string }) => {
      void event;
    },
    onclose: () => {},
    onerror: (event: unknown) => {
      void event;
    },
  };
};

export type FakeSocket = ReturnType<typeof fakeSocket>;

// A charge point with a charger row, already attached. `hasRow: false` models
// a pairing-window charger not yet saved. `hasChargerRow` gives a test full
// control over the row lookup to reproduce DB-latency-dependent ordering deterministically.
export const attached = (
  chargerId: string,
  opts: {
    hasRow?: boolean;
    hasChargerRow?: (chargePointId: string) => Promise<boolean>;
    onLiveDataChanged?: (chargePointId: string) => void;
  } = {},
) => {
  const hasRow = opts.hasRow ?? true;
  const logger = new Logger("OcppTest", "error");
  const cs = new OcppCentralSystem(
    logger,
    new PluginDbLogger(() => Promise.resolve(), logger),
    opts.hasChargerRow ?? (() => Promise.resolve(hasRow)),
    opts.onLiveDataChanged,
  );
  const socket = fakeSocket();
  cs.attach(socket as unknown as WebSocket, { chargerId });
  return { cs, socket };
};

// The CALLs we sent to the charger, in order, for one action.
export const callsTo = (socket: FakeSocket, action: string): Frame[] =>
  socket.sent.filter((frame) => frame[0] === 2 && frame[2] === action);

// Answer the CALL we sent most recently, as the charger would.
export const answer = async (
  socket: FakeSocket,
  payload: Record<string, unknown>,
): Promise<void> => {
  const outgoing = socket.sent.filter((frame) => frame[0] === 2).at(-1);
  if (outgoing === undefined) throw new Error("No outgoing CALL to answer");
  socket.onmessage({ data: JSON.stringify([3, outgoing[1], payload]) });
  // Awaiting the negotiator: settling this CALLRESULT resolves the promise it
  // is parked on, and its next CALL only reaches the socket once that
  // continuation has run.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// Deliver a charger-initiated CALL and return what we replied.
export const call = async (
  socket: FakeSocket,
  action: string,
  payload: Record<string, unknown>,
): Promise<Frame> => {
  const before = socket.sent.length;
  socket.onmessage({
    data: JSON.stringify([2, `id-${action}-${before}`, action, payload]),
  });
  // Awaiting the handler: resolveAction awaits the charger-row lookup, so
  // the reply is not on the socket until the microtask queue drains.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return socket.sent[before];
};

// Deliver a MeterValues CALL carrying exactly these sampledValue entries.
export const meterValues = (
  socket: FakeSocket,
  sampledValue: Array<Record<string, unknown>>,
  opts: { transactionId?: number } = {},
) =>
  call(socket, "MeterValues", {
    connectorId: 1,
    ...(opts.transactionId !== undefined
      ? { transactionId: opts.transactionId }
      : {}),
    meterValue: [{ timestamp: new Date().toISOString(), sampledValue }],
  });

// Per-phase sampledValue entries for one measurand: [phase, value] pairs.
export const phased = (
  measurand: string,
  entries: Array<[string, string]>,
  unit?: string,
) =>
  entries.map(([phase, value]) => ({
    measurand,
    value,
    phase,
    ...(unit !== undefined ? { unit } : {}),
  }));
