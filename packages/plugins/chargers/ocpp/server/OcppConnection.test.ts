import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { attached, fakeSocket } from "./test-helpers/ocppHarness.ts";
// A CALL we sent is parked on the charger's answer. When that socket goes
// away — reconnect, disconnect, shutdown, or a cancelled pairing window — the
// answer can never arrive, so the caller must be failed rather than left to
// time out 30s later on OcppFraming's CALL_TIMEOUT_MS.

describe("OCPP connection lifecycle", () => {
  const CP = "ABB-83214";

  it("fails a call still in flight when the charger reconnects", async () => {
    const { cs } = attached(CP);

    // ping() sends GetConfiguration and parks on the reply. The charger never
    // answers it — it drops the socket and dials back in instead.
    const inFlight = cs.ping(CP);
    cs.attach(fakeSocket() as unknown as WebSocket, { chargerId: CP });

    await expect(inFlight).rejects.toThrow("Charger reconnected");
  });

  it("fails a call still in flight when the charger disconnects", async () => {
    const { cs, socket } = attached(CP);

    const inFlight = cs.ping(CP);
    socket.onclose();

    await expect(inFlight).rejects.toThrow("Charger disconnected");
  });

  it("fails a call still in flight when the central system shuts down", async () => {
    const { cs } = attached(CP);

    const inFlight = cs.ping(CP);
    cs.shutdown();

    await expect(inFlight).rejects.toThrow("Central system shutting down");
  });

  it("fails a call still in flight when a pairing window is cancelled", async () => {
    // No charger row: a pairing-only socket, which cancelPairing closes.
    const { cs } = attached(CP, { hasRow: false });

    const inFlight = cs.ping(CP);
    await cs.cancelPairing();

    await expect(inFlight).rejects.toThrow("Pairing cancelled");
  });
});
