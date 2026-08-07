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
import {
  type PersistLogFn,
  PluginDbLogger,
} from "@chargeha/server/lib/PluginDbLogger";
import { startTapoSimulator } from "../../../../../devtools/tapo-simulator/main.ts";
import { KlapClient } from "./KlapClient.ts";
import { TapoAuthError, TapoLockedError } from "./errors.ts";
import type { TapoDeviceInfo } from "./TapoChargerAdapter.ts";

describe("KlapClient handshake", () => {
  const CREDS = { email: "user@example.com", password: "example-password" };
  const testLogger = new Logger("TapoTest", "error");

  const withSimulator = async (
    run: (
      client: (overrides?: Partial<typeof CREDS>) => KlapClient,
      sim: ReturnType<typeof startTapoSimulator>,
      dbLogCalls: Array<
        { level: string; message: string; payload: string | null }
      >,
    ) => Promise<void>,
  ): Promise<void> => {
    const sim = startTapoSimulator();
    const dbLogCalls: Array<
      { level: string; message: string; payload: string | null }
    > = [];
    const persist: PersistLogFn = (entry) => {
      dbLogCalls.push(entry);
      return Promise.resolve();
    };
    try {
      await run(
        (overrides = {}) =>
          new KlapClient(
            `127.0.0.1:${sim.devicePort}`,
            overrides.email ?? CREDS.email,
            overrides.password ?? CREDS.password,
            new Logger("TapoTest", "error"),
            new PluginDbLogger(persist, testLogger),
            "charger-1",
          ),
        sim,
        dbLogCalls,
      );
    } finally {
      await sim.stop();
    }
  };

  it("completes the handshake and reads device info", async () => {
    await withSimulator(async (client, _sim, dbLogCalls) => {
      const info = await client().request<TapoDeviceInfo>("get_device_info");
      expect(info.model).toBe("P110");
      // A device call writes a plugin log row.
      expect(dbLogCalls.length).toBeGreaterThan(0);
    });
  });

  it("raises TapoAuthError when the password is wrong", async () => {
    await withSimulator(async (client, _sim, dbLogCalls) => {
      await expect(client({ password: "nope" }).handshake())
        .rejects.toBeInstanceOf(TapoAuthError);
      // Auth failure writes a row at error level.
      const authFailure = dbLogCalls.find((c) => c.level === "error");
      expect(authFailure).toBeDefined();
    });
  });

  it("raises TapoLockedError — not an auth error — on a 403 handshake1", async () => {
    await withSimulator(async (client, sim, dbLogCalls) => {
      sim.sim.applyPatch({ locked: true });
      const error = await client().handshake().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TapoLockedError);
      // Correct credentials, so the message must point at the device setting.
      expect((error as Error).message).toContain("Third-Party Compatibility");
      const lockout = dbLogCalls.find((c) => c.level === "warn");
      expect(lockout).toBeDefined();
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

  it("never logs the email or password, in any level, message, or payload", async () => {
    await withSimulator(async (client, sim, dbLogCalls) => {
      // Exercise every logged path: success, session expiry/re-handshake,
      // wrong password, and a locked device.
      const c = client();
      await c.request<TapoDeviceInfo>("get_device_info");
      sim.sim.expireSession();
      await c.request<TapoDeviceInfo>("get_device_info");
      // Both rejections are expected here — this test only cares that
      // whatever gets logged along the way never carries the credentials.
      await expect(client({ password: "nope" }).handshake())
        .rejects.toBeInstanceOf(TapoAuthError);
      sim.sim.applyPatch({ locked: true });
      await expect(client().handshake()).rejects.toBeInstanceOf(
        TapoLockedError,
      );

      const serialized = JSON.stringify(dbLogCalls);
      expect(serialized).not.toContain(CREDS.email);
      expect(serialized).not.toContain(CREDS.password);
      expect(serialized).not.toContain("nope");
    });
  });
});
