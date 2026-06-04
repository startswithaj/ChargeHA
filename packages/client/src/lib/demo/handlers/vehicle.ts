import type { QueryHandler } from "./types.ts";

export const vehicleHandlers: Record<string, QueryHandler> = {
  // Simulated vehicles are always commandable in demo.
  "vehicle.commandStatus": () => ({ commandsDisabled: false, reason: null }),
};
