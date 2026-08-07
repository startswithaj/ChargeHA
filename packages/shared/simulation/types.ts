// ---- Config ----

export interface VehicleConfig {
  id: string;
  name: string;
  priority: number;
  batteryStart: number;
  chargeLimit: number;
  chargeAmpsMin: number;
  chargeAmpsMax: number;
  batteryCapacityKwh: number;
}

export interface SolarConfig {
  seed: number;
  peakKw: number;
  cloudiness: number;
  storms: number;
  homeBaseW: number;
  sunrise: number;
  sunset: number;
}

export interface SimulationOptions {
  seed: number;
  vehicles: VehicleConfig[];
  waterfall: boolean;
  minGenKw: string;
  graceMin: string;
  cooldownMin: string;
  peakSolarKw: number;
  minExcessKw: string;
  cloudiness: number;
  storms: number;
  homeLoad: number;
  sunrise: number;
  sunset: number;
  ampDebounceThreshold?: number;
  ampDebounceSettleMinutes?: number;
}

/** A charging point with a fixed default configuration, used to seed the
 *  simulator UI and CLI/browser devtools with a sensible starting point. */
export function makeDefaultVehicleConfig(
  overrides: Partial<VehicleConfig> & { id: string; name: string },
): VehicleConfig {
  return {
    priority: 1,
    batteryStart: 40,
    chargeLimit: 100,
    chargeAmpsMin: 5,
    chargeAmpsMax: 32,
    batteryCapacityKwh: 75,
    ...overrides,
  };
}

// ---- Results ----

export interface VehicleResult {
  chargeAmps: number;
  chargePowerW: number;
  isCharging: boolean;
  batteryLevel: number;
}

export interface ControllerEvent {
  minute: number;
  time: string;
  vehicleId: string;
  vehicleName: string;
  action: string;
  detail: string;
  targetAmps: number | null;
  checksJson: string;
}

export interface SimResult {
  minute: number;
  time: string;
  solarW: number;
  homeW: number;
  gridW: number;
  excessW: number;
  vehicles: VehicleResult[];
}

export interface SimulationOutput {
  results: SimResult[];
  events: ControllerEvent[];
}

// ---- Energy reading (internal) ----

export interface EnergyReading {
  minute: number;
  time: string;
  solarW: number;
  homeW: number;
  gridW: number;
}
