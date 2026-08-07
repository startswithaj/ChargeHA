import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import { OCPP_SECRET_KEYS, ocppConfigDef } from "./config.ts";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";

/** Long enough to walk to the charger and paste a URL into its app, short
 *  enough that an unattended window closes on its own. */
const PAIRING_TTL_MS = 3 * 60 * 1000;

/** Same default as bootstrap.ts, which owns the actual listen port. */
const serverPort = (): string => Deno.env.get("PORT") ?? "8000";

const WS_PATH = "/api/charger/ocpp";

/** Which charger row to act on. Named `chargerRowId` because OCPP already
 *  uses "charger id" for the device-announced charge point id, and mixing the
 *  two is the single easiest mistake to make in this file. */
const chargerInput = z.object({
  chargerRowId: z.string(),
});

/** The OCPP charge point id configured on one charger row, or null when that
 *  row has not been given one yet. The only place a row id becomes a charge
 *  point id in the router. */
async function chargePointIdFor(
  deps: PluginDependencies,
  chargerRowId: string,
): Promise<string | null> {
  const { config } = await deps.resolveChargerConfig(chargerRowId);
  return config.charger_id ?? null;
}

/** Virtual interfaces a charger can never route to: container bridges, VPN
 *  tunnels, virtual-machine adapters. Offering these as candidates sends the
 *  user down a dead end. */
const VIRTUAL_IFACE = /^(docker|br-|veth|utun|tun|tap|vmnet|vboxnet|zt|wg)/i;

/** LAN addresses a charger could plausibly dial. */
function lanBaseUrls(
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): string[] {
  try {
    return networkInterfaces()
      .filter((i) =>
        i.family === "IPv4" &&
        !VIRTUAL_IFACE.test(i.name) &&
        !i.address.startsWith("127.") &&
        !i.address.startsWith("169.254.") &&
        // A .0 host part is a network address, never a reachable host.
        !i.address.endsWith(".0")
      )
      .map((i) => `ws://${i.address}:${serverPort()}${WS_PATH}`);
  } catch (error) {
    // Reading interfaces needs --allow-sys, which the test task does not
    // grant. A settings page must not fail over a missing permission.
    if (!(error instanceof Deno.errors.NotCapable)) throw error;
    return [];
  }
}

/** The pairing lifecycle, grouped so the main router stays readable.
 *  Session-authenticated: the whole /trpc mount sits behind
 *  createAuthMiddleware — only the charger websocket itself is public. */
function pairingProcedures(
  deps: PluginDependencies,
  centralSystem: OcppCentralSystem,
) {
  return {
    /** Open a window in which a charger announcing any id may connect
     *  provisionally, so it can prove it reaches us before an id is saved.
     *  Plugin-wide by nature: the window is a property of the listener, not
     *  of any one charger row. */
    beginPairing: publicProcedure.mutation(() => {
      centralSystem.armPairing(PAIRING_TTL_MS);
      return { expiresInMs: PAIRING_TTL_MS };
    }),

    cancelPairing: publicProcedure.mutation(() => {
      centralSystem.cancelPairing();
      return { armed: false as const };
    }),

    /** Called after a charger id is saved ON A ROW: the live pairing socket
     *  becomes a full connection instead of forcing the charger to reconnect.
     *  Row-scoped so "pair charger row B" is expressible — previously the one
     *  saved plugin-wide id was the only possible pairing target. */
    promotePairing: publicProcedure
      .input(chargerInput)
      .mutation(async ({ input }) => {
        const chargePointId = await chargePointIdFor(
          deps,
          input.chargerRowId,
        );
        const announced = centralSystem.pairingState().announcedId;
        if (chargePointId === null || chargePointId !== announced) {
          return {
            success: false as const,
            error: "Saved charger id does not match the charger that connected",
          };
        }
        centralSystem.promotePairing();
        return { success: true as const };
      }),
  };
}

export function createOcppRouter(
  deps: PluginDependencies,
  centralSystem: OcppCentralSystem,
) {
  return router({
    ...createPluginConfigProcedures(deps, ocppConfigDef, OCPP_SECRET_KEYS),

    /** Connection status + charger info for settings/wizard live display,
     *  for ONE charger row. */
    status: publicProcedure
      .input(chargerInput)
      .query(async ({ input }) => {
        const chargePointId = await chargePointIdFor(deps, input.chargerRowId);
        // No id yet means nothing can have connected — report absence rather
        // than probing the central system with an empty-string key.
        const data = chargePointId === null
          ? null
          : centralSystem.getData(chargePointId);
        const pairing = centralSystem.pairingState();
        return {
          connected: data?.connected ?? false,
          provisional: data?.provisional ?? false,
          // A charger is dialling in but being turned away — almost always
          // because it was set up before the user pressed Listen.
          knocking: centralSystem.knockingCharger(),
          info: data?.info ?? null,
          status: data?.status ?? null,
          // Client composes ws://<location.hostname>:<port> + this path.
          // null until a charge point id is configured on this row (no
          // empty-string sentinels).
          wsPath: chargePointId === null
            ? null
            : `/api/charger/ocpp/${chargePointId}`,
          // Non-null once a charger has reached us during a pairing window.
          pairing: {
            armed: pairing.armed,
            // Epoch ms so the panel can show its own countdown without needing
            // a second endpoint or guessing the TTL.
            expiresAt: pairing.expiresAt,
            announcedId: pairing.announcedId,
            info: pairing.info,
            // Every charger seen this window, so the panel can offer a choice
            // rather than silently keeping whichever connected last.
            seen: pairing.seen,
          },
        };
      }),

    /** URLs a charger can actually reach, so the panel stops guessing from
     *  window.location — which yields the browser's loopback and, on the dev
     *  server, the wrong port entirely. */
    connectionUrls: publicProcedure
      .input(chargerInput)
      .query(async ({ input }) => {
        const chargePointId = await chargePointIdFor(deps, input.chargerRowId);
        return {
          candidates: lanBaseUrls().map((base) => ({
            base,
            full: chargePointId === null ? null : `${base}/${chargePointId}`,
          })),
        };
      }),

    ...pairingProcedures(deps, centralSystem),

    testConnection: publicProcedure
      .input(chargerInput)
      .mutation(async ({ input }) => {
        const chargePointId = await chargePointIdFor(deps, input.chargerRowId);
        if (
          chargePointId === null ||
          !centralSystem.getData(chargePointId).connected
        ) {
          return {
            success: false as const,
            error: "Charger not connected — check the charger URL in its " +
              "OCPP settings and your network",
          };
        }
        try {
          const { latencyMs } = await centralSystem.ping(chargePointId);
          return { success: true as const, latencyMs };
        } catch (error) {
          return {
            success: false as const,
            error: error instanceof Error ? error.message : "Round trip failed",
          };
        }
      }),
  });
}
