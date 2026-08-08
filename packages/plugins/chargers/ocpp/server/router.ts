import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { detectLanAddresses } from "@chargeha/server/lib/LanInterfaces";
import { createChargerConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import { OCPP_SECRET_KEYS, ocppConfigDef } from "./config.ts";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";

/** Long enough to walk to the charger and paste a URL into its app, short
 *  enough that an unattended window closes on its own. */
const PAIRING_TTL_MS = 5 * 60 * 1000;

/** Same default as bootstrap.ts, which owns the actual listen port. */
const serverPort = (): string => Deno.env.get("PORT") ?? "8000";

const WS_PATH = "/api/charger/ocpp";

/** Which charger row to act on. Named `chargerRowId` because OCPP already
 *  uses "charger id" for the device-announced charge point id, and mixing the
 *  two is the single easiest mistake to make in this file. */
const chargerInput = z.object({
  chargerRowId: z.string(),
});

/** Either identifier works. Settings acts on a saved row; the wizard has only
 *  the id the charger announced, because no row exists until Next saves. */
const testConnectionInput = z.union([
  chargerInput,
  z.object({ chargePointId: z.string().min(1) }),
]);

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

/** LAN addresses a charger could plausibly dial. Interface filtering
 *  (virtual/loopback/link-local/network-address exclusion, and the missing
 *  `--allow-sys` fallback) lives in the shared `detectLanAddresses` — this
 *  just turns those addresses into connection URLs. */
function lanBaseUrls(
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): string[] {
  return detectLanAddresses(networkInterfaces).map((address) =>
    `ws://${address}:${serverPort()}${WS_PATH}`
  );
}

/** The pairing lifecycle, grouped so the main router stays readable.
 *  Session-authenticated: the whole /trpc mount sits behind
 *  createAuthMiddleware — only the charger websocket itself is public. */
function pairingProcedures(centralSystem: OcppCentralSystem) {
  return {
    /** Open a window in which a charger announcing any id may connect
     *  provisionally, so it can prove it reaches us before an id is saved.
     *  Plugin-wide by nature: the window is a property of the listener, not
     *  of any one charger row. */
    beginPairing: publicProcedure.mutation(() => {
      centralSystem.armPairing(PAIRING_TTL_MS);
      return { expiresInMs: PAIRING_TTL_MS };
    }),

    cancelPairing: publicProcedure.mutation(async () => {
      await centralSystem.cancelPairing();
      return { armed: false as const };
    }),

    /** The pairing window's facts, row-independent by nature — this is what
     *  add mode / the first-run wizard reads, since no charger row exists yet
     *  for them to scope a query to. */
    pairingStatus: publicProcedure.query(() => {
      const pairing = centralSystem.pairingState();
      return {
        pairing: {
          armed: pairing.armed,
          // Epoch ms, which identifies the window — the panel re-anchors its
          // countdown when this changes.
          expiresAt: pairing.expiresAt,
          // Time left by the SERVER's clock. The panel counts down from this
          // rather than subtracting `expiresAt` from its own clock: the two
          // machines disagree by seconds, which showed as "5:04 left" on a
          // five-minute window.
          expiresInMs: pairing.expiresAt === null
            ? null
            : Math.max(0, pairing.expiresAt - Date.now()),
          announcedId: pairing.announcedId,
          info: pairing.info,
          // Every charger seen this window, so the panel can offer a choice
          // rather than silently keeping whichever connected last.
          seen: pairing.seen,
        },
        // A charger is dialling in but being turned away — almost always
        // because it was set up before the user pressed Listen.
        knocking: centralSystem.knockingCharger(),
        baseUrls: lanBaseUrls(),
      };
    }),
  };
}

export function createOcppRouter(
  deps: PluginDependencies,
  centralSystem: OcppCentralSystem,
) {
  return router({
    ...createChargerConfigProcedures(deps, ocppConfigDef, OCPP_SECRET_KEYS),

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
        return {
          connected: data?.connected ?? false,
          info: data?.info ?? null,
          status: data?.status ?? null,
          // Client composes ws://<location.hostname>:<port> + this path.
          // null until a charge point id is configured on this row (no
          // empty-string sentinels).
          wsPath: chargePointId === null
            ? null
            : `/api/charger/ocpp/${chargePointId}`,
        };
      }),

    ...pairingProcedures(centralSystem),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(async ({ input }) => {
        const chargePointId = "chargePointId" in input
          ? input.chargePointId
          : await chargePointIdFor(deps, input.chargerRowId);
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
