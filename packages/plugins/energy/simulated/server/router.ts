import { router } from "../../../../server/src/trpc/trpc.ts";
import { simulatedEnergyConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";

// ── Simulated Energy plugin tRPC router ──────────────────────────────────────
// Config get/set only — the simulator needs no discovery or connection test.

export function createSimulatedEnergyRouter(deps: PluginDependencies) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      simulatedEnergyConfigDef,
      [],
    ),
  });
}
