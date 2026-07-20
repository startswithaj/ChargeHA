import type { MutationHandlers } from "../types.ts";
import {
  buildSectionInputSchema,
  serializeSection,
} from "@chargeha/shared/configSections";
import { simulatedEnergyConfigDef } from "../../../../../../plugins/energy/simulated/server/config.ts";
import { updateDemoState } from "../../demoState.ts";

type EnergyMutations = Pick<
  MutationHandlers,
  "plugin.energy.simulated_energy.setConfig"
>;

const inputSchema = buildSectionInputSchema(simulatedEnergyConfigDef);

export const energyMutations: EnergyMutations = {
  // Persist the simulated-energy config into demo state (same shape the server
  // writes). The live tick reads it to simulate solar, so edits take effect.
  "plugin.energy.simulated_energy.setConfig": (input) => {
    const validated = inputSchema.parse(input);
    const kv = serializeSection(simulatedEnergyConfigDef, validated);
    updateDemoState((m) => ({ ...m, config: { ...m.config, ...kv } }));
  },
};
