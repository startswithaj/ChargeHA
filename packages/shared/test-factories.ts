/**
 * Shared test factories for building mock data with sensible defaults.
 * Usage: `buildVehicleChargeState({ batteryLevel: 95 })` — override only what matters for your test.
 */
import type {
  BlockoutSchedule,
  ChargeSchedule,
  EnergyData,
  VehicleChargeState,
} from "./types.ts";

export function buildEnergyData(
  overrides: Partial<EnergyData> = {},
): EnergyData {
  return {
    solarProductionW: 5000,
    gridPowerW: -1000,
    homeConsumptionW: 4000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function buildVehicleChargeState(
  overrides: Partial<VehicleChargeState> = {},
): VehicleChargeState {
  return {
    vehicleId: "VIN-TEST",
    batteryLevel: 60,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 0,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 0,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: false,
    vehicleName: "Test Car",
    lastUpdated: "2026-01-01T00:00:00.000Z",
    latitude: null,
    longitude: null,
    isHome: null,
    ...overrides,
  };
}

export function buildChargeSchedule(
  overrides: Partial<Omit<ChargeSchedule, "scheduleType">> = {},
): ChargeSchedule {
  return {
    id: "sched-charge-1",
    vehicleId: "VIN-TEST",
    scheduleType: "charge",
    startTime: "08:00",
    endTime: "16:00",
    days: ["mon", "tue", "wed", "thu", "fri"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
    ...overrides,
  };
}

export function buildBlockoutSchedule(
  overrides: Partial<Omit<BlockoutSchedule, "scheduleType" | "vehicleId">> = {},
): BlockoutSchedule {
  return {
    id: "sched-blockout-1",
    vehicleId: null,
    scheduleType: "blockout",
    startTime: "18:00",
    endTime: "21:00",
    days: ["mon", "tue", "wed", "thu", "fri"],
    enabled: true,
    ...overrides,
  };
}
