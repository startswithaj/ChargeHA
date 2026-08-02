import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import { TAPO_SECRET_KEYS, tapoConfigDef } from "./config.ts";
import { discoverTapo } from "./TapoDiscovery.ts";
import { KlapClient } from "./KlapClient.ts";
import { TapoApiError, TapoAuthError } from "./errors.ts";
import type { TapoDeviceInfo, TapoEnergyUsage } from "./TapoChargerAdapter.ts";

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  email: z.string(),
  password: z.string(),
});

const setPowerInput = z.object({
  on: z.boolean(),
});

async function savedClient(deps: PluginDependencies): Promise<KlapClient> {
  const [host, email, password] = await Promise.all([
    deps.getConfig("host"),
    deps.getConfig("email"),
    deps.getSecret("password"),
  ]);
  if (!host || !email || !password) {
    throw new Error("Tapo plug not configured");
  }
  return new KlapClient(host, email, password, new Logger("Tapo", "error"));
}

function testFailure(err: unknown) {
  if (err instanceof TapoAuthError) {
    return { success: false as const, error: "Wrong Tapo email or password" };
  }
  return {
    success: false as const,
    error: err instanceof Error ? err.message : "Connection failed",
  };
}

export function createTapoRouter(deps: PluginDependencies) {
  return router({
    ...createPluginConfigProcedures(deps, tapoConfigDef, TAPO_SECRET_KEYS),

    discover: publicProcedure
      .input(discoverInput)
      .mutation(async ({ input }) => {
        const found = await discoverTapo(deps.log, input.subnet);
        return { found };
      }),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(async ({ input }) => {
        const client = new KlapClient(
          input.host,
          input.email,
          input.password,
          new Logger("Tapo", "error"),
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
        const client = await savedClient(deps);
        await client.request("set_device_info", { device_on: input.on });
        return { on: input.on };
      }),

    status: publicProcedure.query(async () => {
      const client = await savedClient(deps);
      // Sequential — same one-request-at-a-time rule as the adapter.
      const info = await client.request<TapoDeviceInfo>("get_device_info");
      const energy = await client.request<TapoEnergyUsage>("get_energy_usage");
      return {
        on: info.device_on,
        powerW: energy.current_power / 1000,
        model: info.model,
      };
    }),
  });
}
