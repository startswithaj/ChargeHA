import { router } from "../../../../server/src/trpc/trpc.ts";
import { simulatedEnergyConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";

// ── Simulated Energy plugin tRPC router ──────────────────────────────────────
// Config get/set only — the simulator needs no discovery or connection test.

export const simulatedEnergyRouter = router({
  ...createPluginConfigProcedures(
    "simulated_energy",
    simulatedEnergyConfigDef,
    [],
  ),
});
