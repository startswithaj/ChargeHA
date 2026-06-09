import type { QueryHandler } from "./types.ts";

export const wizardHandlers: Record<string, QueryHandler> = {
  "wizard.status": (_i, s) => {
    const completed = s.config.wizard_completed === "true";
    const firstRun = !completed && s.vehicles.length === 0 &&
      !s.config.energy_adapter_type;
    return { completed, firstRun };
  },
  "wizard.getStep": (_i, s) => s.config.wizard_step ?? "",
  "wizard.getVehicleType": (_i, s) => s.config.wizard_vehicle_type ?? "",
  "wizard.getEnergyType": (_i, s) => s.config.wizard_energy_type ?? "",
};
