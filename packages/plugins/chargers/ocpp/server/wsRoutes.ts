import { Hono } from "hono";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";

// Public routes for OCPP websockets.
export function createOcppWsRoutes(
  deps: PluginDependencies,
  centralSystem: OcppCentralSystem,
): Hono {
  const app = new Hono();

  app.get("/:chargerId", async (c) => {
    const chargerId = c.req.param("chargerId");
    const entries = await deps.resolveChargerConfigs();
    const adopted = entries.some((e) => e.config.charger_id === chargerId);
    // An unknown id may connect provisionally to prove reachability; nothing it sends is persisted.
    const pairing = !adopted && centralSystem.acceptsPairing();
    if (!adopted && !pairing) {
      // Log once, then at most once a minute: a charger configured before the
      // user pressed Listen retries every couple of seconds indefinitely.
      if (centralSystem.shouldLogRejection(chargerId)) {
        deps.log.warn(`OCPP connect rejected: unknown charger id ${chargerId}`);
        deps.dbLog.warn(`Connect rejected, unknown charger id (${chargerId})`, {
          payload: { chargePointId: chargerId },
        });
      }
      centralSystem.noteRejected(chargerId);
      return c.text("Unknown charger", 404);
    }

    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.text("Expected WebSocket upgrade", 400);
    }
    // Deno.upgradeWebSocket only echoes the protocol, so check ocpp1.6 was actually offered.
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
    socket.onopen = () => centralSystem.attach(socket, { chargerId });
    return response;
  });

  return app;
}
