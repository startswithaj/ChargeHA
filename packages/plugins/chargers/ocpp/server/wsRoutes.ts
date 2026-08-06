import { Hono } from "hono";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";

/** The public: true mount. Path (relative to /api/charger/ocpp):
 *  GET /:chargerId — WS upgrade. Validates the configured charger id, then upgrades and hands the
 *  socket to the central system. */
export function createOcppWsRoutes(
  deps: PluginDependencies,
  centralSystem: OcppCentralSystem,
): Hono {
  const app = new Hono();

  app.get("/:chargerId", async (c) => {
    const chargerId = c.req.param("chargerId");
    const configuredId = await deps.getConfig("charger_id");
    const adopted = configuredId !== null && chargerId === configuredId;
    // Pairing accepts an id we have never seen, so the panel can prove the
    // charger reaches us before the user commits an id. The connection is
    // provisional: OcppCentralSystem refuses everything outside the pairing
    // action set, so nothing it sends is trusted or persisted.
    const pairing = !adopted && centralSystem.acceptsPairing();
    if (!adopted && !pairing) {
      // Log once, then at most once a minute: a charger configured before the
      // user pressed Listen retries every couple of seconds indefinitely.
      if (centralSystem.shouldLogRejection(chargerId)) {
        deps.log.warn(`OCPP connect rejected: unknown charger id ${chargerId}`);
      }
      centralSystem.noteRejected(chargerId);
      return c.text("Unknown charger", 404);
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
    if (pairing) {
      deps.log.info(`OCPP pairing: charger announced id ${chargerId}`);
      centralSystem.notePairedCharger(chargerId);
    }
    socket.onopen = () =>
      centralSystem.attach(socket, { provisional: pairing, chargerId });
    return response;
  });

  return app;
}
