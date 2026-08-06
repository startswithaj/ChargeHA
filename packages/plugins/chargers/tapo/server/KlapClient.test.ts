// Covers the handshake outcomes that are easy to confuse in the field, driven
// against the real TapoSimulator so the KLAP crypto is exercised end to end.
//
// The distinction that matters: handshake1 carries only a random seed, never a
// credential. A 403 there means local control is switched off at the device
// (firmware 1.4.x defaults to TP-Link's TPAP scheme with KLAP disabled), which
// no amount of correcting the email or password will fix. Reporting that as an
// auth failure sent a real user hunting for a password problem that did not
// exist.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { startTapoSimulator } from "../../../../../devtools/tapo-simulator/main.ts";
import { KlapClient } from "./KlapClient.ts";
import { TapoAuthError, TapoLockedError } from "./errors.ts";
import type { TapoDeviceInfo } from "./TapoChargerAdapter.ts";

describe("KlapClient handshake", () => {
  const CREDS = { email: "user@example.com", password: "example-password" };

  const withSimulator = async (
    run: (
      client: (overrides?: Partial<typeof CREDS>) => KlapClient,
      sim: ReturnType<typeof startTapoSimulator>,
    ) => Promise<void>,
  ): Promise<void> => {
    const sim = startTapoSimulator();
    try {
      await run(
        (overrides = {}) =>
          new KlapClient(
            `127.0.0.1:${sim.devicePort}`,
            overrides.email ?? CREDS.email,
            overrides.password ?? CREDS.password,
            new Logger("TapoTest", "error"),
          ),
        sim,
      );
    } finally {
      await sim.stop();
    }
  };

  it("completes the handshake and reads device info", async () => {
    await withSimulator(async (client) => {
      const info = await client().request<TapoDeviceInfo>("get_device_info");
      expect(info.model).toBe("P110");
    });
  });

  it("raises TapoAuthError when the password is wrong", async () => {
    await withSimulator(async (client) => {
      await expect(client({ password: "nope" }).handshake())
        .rejects.toBeInstanceOf(TapoAuthError);
    });
  });

  it("raises TapoLockedError — not an auth error — on a 403 handshake1", async () => {
    await withSimulator(async (client, sim) => {
      sim.sim.applyPatch({ locked: true });
      const error = await client().handshake().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TapoLockedError);
      // Correct credentials, so the message must point at the device setting.
      expect((error as Error).message).toContain("Third-Party Compatibility");
    });
  });

  it("re-handshakes transparently after the session expires", async () => {
    await withSimulator(async (client, sim) => {
      const c = client();
      await c.request<TapoDeviceInfo>("get_device_info");
      sim.sim.expireSession();
      const info = await c.request<TapoDeviceInfo>("get_device_info");
      expect(info.model).toBe("P110");
    });
  });
});
