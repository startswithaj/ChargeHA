import { Hono } from "hono";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";

/** The public: true mount. Path (relative to /api/charger/ocpp):
 *  GET /:chargerId — WS upgrade. Validates the configured charger id, then
 *  Basic Auth when an AuthorizationKey is set, then upgrades and hands the
 *  socket to the central system. */
export function createOcppWsRoutes(
  deps: PluginDependencies,
  centralSystem: OcppCentralSystem,
): Hono {
  const app = new Hono();

  app.get("/:chargerId", async (c) => {
    const chargerId = c.req.param("chargerId");
    const configuredId = await deps.getConfig("charger_id");
    if (!configuredId || chargerId !== configuredId) {
      deps.log.warn(`OCPP connect rejected: unknown charger id ${chargerId}`);
      return c.text("Unknown charger", 404);
    }

    const authKey = await deps.getSecret("authorization_key");
    if (
      authKey &&
      !validBasicAuth(c.req.header("Authorization"), chargerId, authKey)
    ) {
      deps.log.warn("OCPP connect rejected: bad Authorization");
      return c.text("Unauthorized", 401);
    }

    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.text("Expected WebSocket upgrade", 400);
    }
    // Deno.upgradeWebSocket's protocol option only echoes the value — it
    // does not verify the client offered it. Reject non-1.6 chargers
    // (e.g. 1.5 or 2.0.1) with a clear error instead of a broken session.
    const offered = c.req.header("Sec-WebSocket-Protocol") ?? "";
    if (!offered.split(",").map((p) => p.trim()).includes("ocpp1.6")) {
      deps.log.warn(`OCPP connect rejected: protocols [${offered}]`);
      return c.text("Subprotocol ocpp1.6 required", 400);
    }
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw, {
      protocol: "ocpp1.6",
    });
    socket.onopen = () => centralSystem.attach(socket);
    return response;
  });

  return app;
}

function validBasicAuth(
  header: string | undefined,
  chargerId: string,
  key: string,
): boolean {
  const expected = `Basic ${btoa(`${chargerId}:${key}`)}`;
  return header === expected;
}
