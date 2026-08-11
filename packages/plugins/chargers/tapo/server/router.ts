import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import {
  createChargerConfigProcedures,
  createNetworkDiscoveryProcedures,
} from "../../../createPluginConfigProcedures.ts";
import { TAPO_SECRET_KEYS, tapoConfigDef } from "./config.ts";
import { discoverTapo } from "./TapoDiscovery.ts";
import { KlapClient } from "./KlapClient.ts";
import { TapoApiError, TapoAuthError, TapoLockedError } from "./errors.ts";
import { decodeNickname } from "./TapoChargerAdapter.ts";
import type { TapoDeviceInfo, TapoEnergyUsage } from "./TapoChargerAdapter.ts";

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  email: z.string(),
  password: z.string(),
});

// Which charger row to act on. `chargerRowId`, not `chargerId`, because a
// Tapo row has no device-side id and the two would be easy to confuse.
const chargerInput = z.object({
  chargerRowId: z.string(),
});

const setPowerInput = z.object({
  chargerRowId: z.string(),
  on: z.boolean(),
});

// A client for the plug configured on ONE charger row. Two Tapo rows resolve
// to two different plugs; there is no "the" saved plug any more.
async function savedClient(
  deps: PluginDependencies,
  chargerRowId: string,
): Promise<KlapClient> {
  const { config, secrets } = await deps.resolveChargerConfig(chargerRowId);
  const { host, email } = config;
  const password = secrets.password;
  if (!host || !email || !password) {
    throw new Error("Tapo plug not configured");
  }
  return new KlapClient(
    host,
    email,
    password,
    deps.log,
    deps.dbLog,
    chargerRowId,
  );
}

function testFailure(err: unknown) {
  if (err instanceof TapoAuthError) {
    return { success: false as const, error: "Wrong Tapo email or password" };
  }
  // Carries its own remedy — the credentials are irrelevant to this failure.
  if (err instanceof TapoLockedError) {
    return { success: false as const, error: err.message };
  }
  return {
    success: false as const,
    error: err instanceof Error ? err.message : "Connection failed",
  };
}

export function createTapoRouter(deps: PluginDependencies) {
  return router({
    ...createChargerConfigProcedures(deps, tapoConfigDef, TAPO_SECRET_KEYS),
    ...createNetworkDiscoveryProcedures(deps),

    discover: publicProcedure
      .input(discoverInput)
      .mutation(async ({ input }) => {
        const found = await discoverTapo(deps.log, input.subnet);
        return { found };
      }),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(async ({ input }) => {
        const logger = deps.log;
        const client = new KlapClient(
          input.host,
          input.email,
          input.password,
          logger,
          deps.dbLog,
          // No charger row exists yet during wizard setup — a stable label
          // instead of an id keeps this call distinguishable in the log.
          "wizard-test-connection",
        );
        try {
          await client.handshake();
          const info = await client.request<TapoDeviceInfo>("get_device_info");
          const energy = await client
            .request<TapoEnergyUsage>("get_energy_usage")
            .catch((error: unknown) => {
              // Only a device-level rejection means meterless; connection
              // errors fall through to the outer catch.
              if (error instanceof TapoApiError) return null;
              throw error;
            });
          if (!energy) {
            return {
              success: false as const,
              error: `This model (${info.model}) has no energy meter — an ` +
                "energy-monitoring model (P110/P115) is required",
            };
          }
          return {
            success: true as const,
            model: info.model,
            firmwareVersion: info.fw_ver,
            // The name set in the Tapo app — what the user calls this plug.
            nickname: decodeNickname(info.nickname, logger),
            powerW: energy.current_power / 1000,
          };
        } catch (err) {
          return testFailure(err);
        }
      }),

    // Wizard verify step: toggle the saved plug and read live power.
    setPower: publicProcedure
      .input(setPowerInput)
      .mutation(async ({ input }) => {
        const client = await savedClient(deps, input.chargerRowId);
        await client.request("set_device_info", { device_on: input.on });
        return { on: input.on };
      }),

    status: publicProcedure
      .input(chargerInput)
      .query(async ({ input }) => {
        const client = await savedClient(deps, input.chargerRowId);
        // Sequential — same one-request-at-a-time rule as the adapter.
        const info = await client.request<TapoDeviceInfo>("get_device_info");
        const energy = await client.request<TapoEnergyUsage>(
          "get_energy_usage",
        );
        return {
          on: info.device_on,
          powerW: energy.current_power / 1000,
          model: info.model,
        };
      }),
  });
}
