export { runSimulation } from "./run.ts";
export { DEFAULT_SOLAR_CONFIG, generateSolarDay, Rng } from "./solar.ts";
export { computeVehicleStats } from "./stats.ts";
export type { AmpChange, VehicleStats } from "./stats.ts";
export type {
  ControllerEvent,
  EnergyReading,
  SimResult,
  SimulationOptions,
  SimulationOutput,
  SolarConfig,
  VehicleConfig,
  VehicleResult,
} from "./types.ts";
