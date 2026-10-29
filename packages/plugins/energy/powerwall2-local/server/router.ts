import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import {
  DEFAULT_POWERWALL_POLL_INTERVAL_SECONDS,
  freshnessSchema,
  gatewayHostSchema,
  pollIntervalSchema,
  POWERWALL2_LOCAL_SECRET_KEYS,
  type Powerwall2LocalConfig,
  powerwall2LocalConfigDef,
} from "./config.ts";

import type { DeviceInfo, EnergyData } from "@chargeha/shared";

interface Powerwall2LocalRouterPlugin {
  testConnection(input: Powerwall2LocalConfig): Promise<
    | { success: true; device: DeviceInfo; realtime: EnergyData }
    | { success: false; error: string }
  >;
}

const testConnectionInput = z.object({
  host: gatewayHostSchema,
  email: z.string(),
  password: z.string().min(1),
  maxStalenessSeconds: freshnessSchema,
  pollIntervalSeconds: pollIntervalSchema.default(
    String(DEFAULT_POWERWALL_POLL_INTERVAL_SECONDS),
  ),
});

export function createPowerwall2LocalRouter(
  deps: PluginDependencies,
  plugin: Powerwall2LocalRouterPlugin,
) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      powerwall2LocalConfigDef,
      POWERWALL2_LOCAL_SECRET_KEYS,
    ),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) => plugin.testConnection(input)),
  });
}
