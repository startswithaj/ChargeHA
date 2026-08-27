import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { detectLanAddresses } from "@chargeha/server/lib/LanInterfaces";
import { createChargerConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import { OCPP_SECRET_KEYS, ocppConfigDef } from "./config.ts";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";
import type { OcppChargerPlugin } from "./OcppChargerPlugin.ts";

const PAIRING_TTL_MS = 5 * 60 * 1000;

// Same default as bootstrap.ts, which owns the actual listen port.
const serverPort = (): string => Deno.env.get("PORT") ?? "8000";

const WS_PATH = "/api/charger/ocpp";

// Which charger row to act on. Named `chargerRowId` because OCPP already
// uses "charger id" for the device-announced charge point id, and mixing the
// two is the single easiest mistake to make in this file.
const chargerInput = z.object({
  chargerRowId: z.string(),
});

// Either identifier works. Settings acts on a saved row; the wizard has only
// the id the charger announced, because no row exists until Next saves.
const testConnectionInput = z.union([
  chargerInput,
  z.object({ chargePointId: z.string().min(1) }),
]);

// LAN addresses a charger could plausibly dial. Interface filtering lives in
// the shared `detectLanAddresses` — this just turns those addresses into
// connection URLs.
function lanBaseUrls(
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): string[] {
  return detectLanAddresses(networkInterfaces).map((address) =>
    `ws://${address}:${serverPort()}${WS_PATH}`
  );
}

// Auth comes from createAuthMiddleware on the /trpc mount; only the charger websocket is public.
function pairingProcedures(centralSystem: OcppCentralSystem) {
  return {
    // Plugin-wide window letting any unknown id connect provisionally to prove reachability before it is saved.
    beginPairing: publicProcedure.mutation(() => {
      centralSystem.armPairing(PAIRING_TTL_MS);
      return { expiresInMs: PAIRING_TTL_MS };
    }),

    cancelPairing: publicProcedure.mutation(async () => {
      await centralSystem.cancelPairing();
      return { armed: false as const };
    }),

    // The pairing window's facts, row-independent by nature — this is what
    // add mode / the first-run wizard reads, since no charger row exists yet.
    pairingStatus: publicProcedure.query(() => {
      const pairing = centralSystem.pairingState();
      return {
        pairing: {
          armed: pairing.armed,
          // Epoch ms, which identifies the window — the panel re-anchors its
          // countdown when this changes.
          expiresAt: pairing.expiresAt,
          expiresInMs: pairing.expiresAt === null
            ? null
            : Math.max(0, pairing.expiresAt - Date.now()),
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
  plugin: Pick<OcppChargerPlugin, "chargePointIdFor" | "testConnection">,
) {
  return router({
    ...createChargerConfigProcedures(deps, ocppConfigDef, OCPP_SECRET_KEYS),

    // Connection status + charger info for settings/wizard live display,
    // for ONE charger row.
    status: publicProcedure
      .input(chargerInput)
      .query(async ({ input }) => {
        const chargePointId = await plugin.chargePointIdFor(input.chargerRowId);
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
      .mutation(async ({ input }) =>
        plugin.testConnection(
          "chargePointId" in input
            ? input.chargePointId
            : await plugin.chargePointIdFor(input.chargerRowId),
        )
      ),
  });
}
