import type { QueryHandler } from "./types.ts";

export const wizardHandlers: Record<string, QueryHandler> = {
  "wizard.status": (_i, s) => {
    const completed = s.config.wizard_completed === "true";
    const firstRun = !completed && s.vehicles.length === 0 &&
      !s.config.energy_adapter_type;
    return { completed, firstRun };
  },
  "wizard.state": (_i, s) => ({
    stepId: s.config.wizard_step ?? "",
    vehicleType: s.config.wizard_vehicle_type ?? "",
    energyType: s.config.wizard_energy_type ?? "",
  }),
};
