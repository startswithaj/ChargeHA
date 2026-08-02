import { expect } from "@std/expect";
import { beforeAll, describe, it } from "@std/testing/bdd";
import { waitFor } from "./helpers.ts";
import { ocppTrpc } from "./ocppHelpers.ts";

describe("OCPP Basic Auth (Security Profile 1)", () => {
  beforeAll(async () => {
    await ocppTrpc.plugin.charger.ocpp.setConfig.mutate({
      ocppChargerId: "vcp-test",
      ocppAuthorizationKey: "e2e-secret-key",
    });
  });

  it("accepts the charger when the key matches", async () => {
    const status = await waitFor(async () => {
      const s = await ocppTrpc.plugin.charger.ocpp.status.query();
      return s.connected ? s : null;
    }, { label: "authed vcp connected", timeoutMs: 60_000 });
    expect(status.connected).toBe(true);
  });

  it("rejects a wrong key with 401 before upgrade", async () => {
    const res = await fetch(
      `${Deno.env.get("E2E_APP_URL") ?? "http://localhost:18000"}` +
        "/api/charger/ocpp/vcp-test",
      {
        headers: {
          Upgrade: "websocket",
          Authorization: `Basic ${btoa("vcp-test:wrong-key")}`,
        },
      },
    );
    await res.body?.cancel();
    expect(res.status).toBe(401);
  });
});
