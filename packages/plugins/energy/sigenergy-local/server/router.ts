import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { SigenergyLocalAdapter } from "./SigenergyLocalAdapter.ts";
import { JsmodbusReader } from "./SigenergyModbusClient.ts";
import { discoverSigenergy } from "./SigenergyDiscovery.ts";
import { sigenergyLocalConfigDef } from "./config.ts";
import {
  createNetworkDiscoveryProcedures,
  createPluginConfigProcedures,
} from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";

const discoverInput = z.object({
  subnet: z.string().optional(),
});

const testConnectionInput = z.object({
  host: z.string(),
  port: z.number().optional(),
  plantUnitId: z.number().optional(),
  deviceUnitId: z.number().optional(),
});

export function createSigenergyLocalRouter(deps: PluginDependencies) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      sigenergyLocalConfigDef,
      [],
    ),
    ...createNetworkDiscoveryProcedures(deps),

    discover: publicProcedure
      .input(discoverInput)
      .mutation(async ({ input }) => {
        const found = await discoverSigenergy(deps.log, input.subnet);
        return { found };
      }),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(async ({ input }) => {
        const logger = new Logger("Sigenergy", "error");
        const plantUnitId = input.plantUnitId ?? 247;
        const deviceUnitId = input.deviceUnitId ?? 1;
        const reader = new JsmodbusReader(
          input.host,
          input.port ?? 502,
          [plantUnitId, deviceUnitId],
          logger,
        );
        const adapter = new SigenergyLocalAdapter(
          reader,
          plantUnitId,
          deviceUnitId,
          logger,
        );
        try {
          await adapter.connect();
          const [device, realtime] = await Promise.all([
            adapter.getDeviceInfo(),
            adapter.getRealtimeData(),
          ]);
          return { success: true as const, device, realtime };
        } catch (err) {
          return {
            success: false as const,
            error: err instanceof Error ? err.message : "Connection failed",
          };
        } finally {
          await adapter.disconnect();
        }
      }),
  });
}
