import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  attached,
  call,
  callsTo,
  type FakeSocket,
} from "./test-helpers/ocppHarness.ts";
import { chargingProfilePayload } from "./OcppMessages.ts";

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
    const [first, second] = callsTo(socket, "SetChargingProfile");
    await answerFrame(socket, first[1], { status: "Accepted" });
    await answerFrame(socket, second[1], { status: "Rejected" });

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

  it("still resolves true when everything is accepted", async () => {
    const { cs, socket } = attached(CP);

    const pending = settle(cs.setChargingProfiles(CP, [
      chargingProfilePayload("ChargePointMaxProfile", 7),
      chargingProfilePayload("TxDefaultProfile", 7),
    ]));
    const [first, second] = callsTo(socket, "SetChargingProfile");
    await answerFrame(socket, first[1], { status: "Accepted" });
    await answerFrame(socket, second[1], { status: "Accepted" });

    expect(await pending).toBe("resolved");
  });
});
