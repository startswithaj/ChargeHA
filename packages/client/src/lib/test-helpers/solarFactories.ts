import type { BlockoutSchedule, ChargeSchedule } from "@chargeha/shared";
import type { SimVehicle, SolarConfig } from "../simulateSolarAllocation.ts";

export const makeConfig = (
  overrides: Partial<SolarConfig> = {},
): SolarConfig => ({
  solarTrackingEnabled: true,
  solarTrackingMode: "solar_only",
  solarReference: "excess",
  solarMarginKw: 0,
  minSolarGenerationKw: 0.2,
  minExcessSolarKw: null,
  gridVoltage: 230,
  threePhaseCharger: false,
  batteryPriorityEnabled: false,
  batteryPriorityLimit: 80,
  ...overrides,
});

export const makeVehicle = (
  overrides: Partial<SimVehicle> = {},
): SimVehicle => ({
  id: "VIN001",
  name: "Model 3",
  priority: 1,
  mode: "auto",
  batteryLevel: 50,
  chargeLimit: 100,
  chargeAmpsMin: 5,
  chargeAmpsMax: 16,
  chargerVoltage: 230,
  chargerPhases: 1,
  ...overrides,
});

export const makeChargeSchedule = (
  overrides: Partial<ChargeSchedule> = {},
): ChargeSchedule => ({
  id: "sched-1",
  vehicleId: "VIN001",
  scheduleType: "charge",
  startTime: "22:00",
  endTime: "06:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
  chargeAmps: 10,
  chargeLimitPct: 80,
  enabled: true,
  ...overrides,
});

export const makeBlockoutSchedule = (
  overrides: Partial<BlockoutSchedule> = {},
): BlockoutSchedule => ({
  id: "block-1",
  vehicleId: null,
  scheduleType: "blockout",
  startTime: "15:00",
  endTime: "21:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
  enabled: true,
  ...overrides,
});
