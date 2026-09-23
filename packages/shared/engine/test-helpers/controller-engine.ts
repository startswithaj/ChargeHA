import {
  selectActiveBlockout,
  selectActiveChargeSchedule,
} from "../Schedules.ts";
import type {
  ControllerConfig,
  EngineInput,
  EngineSchedule,
  EngineVehicleInput,
} from "../types.ts";
import type { EnergyData, VehicleChargeState } from "../../types.ts";

export const makeConfig = (
  overrides?: Partial<ControllerConfig>,
): ControllerConfig => ({
  chargingEnabled: true,
  controllerLoopSeconds: 10,
  solarTrackingEnabled: true,
  solarTrackingMode: "solar_only",
  solarReference: "excess",
  solarMarginKw: 0,
  minSolarGenerationKw: 1,
  minExcessSolarKw: null,
  gridVoltage: 230,
  threePhaseCharger: false,
  consumptionExcludesCharging: false,
  gracePeriodMinutes: 6,
  cooldownPeriodMinutes: 15,
  batteryPriorityEnabled: false,
  batteryPriorityLimit: 0,
  priorityChargingEnabled: false,
  timezone: "",
  ampDebounceThreshold: 2,
  ampDebounceSettleMinutes: 3,
  ...overrides,
});

export const makeState = (
  overrides?: Partial<VehicleChargeState>,
): VehicleChargeState => ({
  vehicleId: "V1",
  batteryLevel: 50,
  chargeLimit: 100,
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
  chargePortOpen: true,
  vehicleName: "EV 1",
  lastUpdated: "2026-01-01T12:00:00Z",
  latitude: null,
  longitude: null,
  isHome: null,
  ...overrides,
});

export const makeVehicle = (
  overrides?: Omit<Partial<EngineVehicleInput>, "state"> & {
    state?: Partial<VehicleChargeState> | null;
  },
): EngineVehicleInput => {
  const { state: stateOverrides, ...vehicleOverrides } = overrides ?? {};
  const id = vehicleOverrides.id ?? "V1";
  const name = vehicleOverrides.name ?? "EV 1";
  const buildState = () => {
    if (stateOverrides === null) return null;
    return makeState({
      vehicleId: id,
      vehicleName: name,
      isHome: true,
      ...stateOverrides,
    });
  };
  const state = buildState();
  return {
    id,
    vehicleId: id,
    name,
    mode: "auto",
    priority: 1,
    state,
    activeSchedule: null,
    ...vehicleOverrides,
  };
};

export const makeEnergy = (
  overrides?: Partial<EnergyData>,
): EnergyData => ({
  solarProductionW: 5000,
  gridPowerW: -3000,
  homeConsumptionW: 2000,
  batteryPowerW: null,
  batterySoc: null,
  gridVoltageV: null,
  lastUpdated: "2026-01-01T12:00:00Z",
  ...overrides,
});

export const makeInput = (
  overrides?: Partial<Omit<EngineInput, "activeBlockout">> & {
    vehicle?: Omit<Partial<EngineVehicleInput>, "state"> & {
      state?: Partial<VehicleChargeState> | null;
    };
    // Raw schedules, resolved into activeBlockout / activeSchedule the way
    // the controller does.
    schedules?: EngineSchedule[];
    energyOverrides?: Partial<EnergyData>;
    configOverrides?: Partial<ControllerConfig>;
  },
): EngineInput => {
  const {
    vehicle,
    schedules = [],
    energyOverrides,
    configOverrides,
    ...inputOverrides
  } = overrides ?? {};
  const config = makeConfig(configOverrides);
  const now = inputOverrides.now ?? new Date("2026-01-01T12:00:00Z");
  const base = makeVehicle(vehicle);
  return {
    config,
    vehicles: [{
      ...base,
      activeSchedule: selectActiveChargeSchedule(
        schedules,
        base,
        now,
        config.timezone,
      ),
    }],
    activeBlockout: selectActiveBlockout(schedules, now, config.timezone),
    energy: makeEnergy(energyOverrides),
    now,
    timestamp: Date.now(),
    ...inputOverrides,
  };
};
