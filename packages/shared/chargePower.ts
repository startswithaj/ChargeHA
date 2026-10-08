import type { EnergyData } from "./types.ts";

// Resolve charger voltage: trust the reading if present and >= 100V,
// otherwise fall back to the inverter grid reading, then the user's configured value.
export function resolveVoltage(
  chargerVoltage: number | null,
  energy: EnergyData | null,
  gridVoltage: number,
): number {
  if (chargerVoltage && chargerVoltage >= 100) return chargerVoltage;
  return energy?.gridVoltageV ?? gridVoltage;
}

export function resolvePhases(
  chargerPhases: number | null,
  threePhaseCharger: boolean,
): number {
  if (chargerPhases === 2 && threePhaseCharger) return 3;
  if (chargerPhases !== null) return chargerPhases;
  return threePhaseCharger ? 3 : 1;
}

export function chargePowerWatts(
  amps: number,
  voltage: number,
  phases: number,
): number {
  return amps * voltage * phases;
}

export function chargePowerKilowatts(
  amps: number,
  voltage: number,
  phases: number,
): number {
  return chargePowerWatts(amps, voltage, phases) / 1000;
}

export function chargeCurrentAmps(
  watts: number,
  voltage: number,
  phases: number,
): number {
  return watts / (voltage * phases);
}
