// ---- Config ----

export interface VehicleConfig {
  id: string;
  name: string;
  priority: number;
  batteryStart: number;
  chargeLimit: number;
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
  vehicleCount: number;
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
  ev1Start: number;
  ev2Start: number;
  ev1CapacityKwh: number;
  ev2CapacityKwh: number;
  ampDebounceThreshold?: number;
  ampDebounceSettleMinutes?: number;
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
