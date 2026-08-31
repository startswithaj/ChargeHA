import type {
  ChargerRow,
  ChargerState,
  ChargeSchedule,
  EnergyData,
  Schedule,
  VehicleChargeState,
} from "@chargeha/shared";
import type { ChargerWithState } from "../../../hooks/useChargers.ts";

// Fixed so specimens do not drift between renders.
export const FIXED_NOW = "2025-06-01T12:00:00.000Z";

export const energy: EnergyData = {
  solarProductionW: 6420,
  gridPowerW: -1180,
  homeConsumptionW: 1240,
  batteryPowerW: -800,
  batterySoc: 64,
  gridVoltageV: 240,
  lastUpdated: FIXED_NOW,
};

export const vehicleState: VehicleChargeState = {
  vehicleId: "5YJ3E1EA7KF000001",
  batteryLevel: 62,
  chargeLimit: 80,
  isCharging: true,
  isPluggedIn: true,
  isOnline: true,
  chargeAmps: 16,
  chargeAmpsMax: 32,
  chargeAmpsMin: 5,
  chargePowerKw: 3.8,
  chargerVoltage: 240,
  chargerPhases: 1,
  energyAddedKwh: 12.4,
  minutesToFull: 95,
  chargePortOpen: true,
  vehicleName: "Model 3",
  lastUpdated: FIXED_NOW,
  latitude: null,
  longitude: null,
  isHome: true,
};

export const idleVehicleState: VehicleChargeState = {
  ...vehicleState,
  batteryLevel: 78,
  isCharging: false,
  isPluggedIn: false,
  chargeAmps: 0,
  chargePowerKw: 0,
  energyAddedKwh: 0,
  minutesToFull: 0,
  chargePortOpen: false,
  vehicleName: "Ioniq 5",
  isHome: false,
};

export const chargerCardState: ChargerState = {
  chargerId: "chg-1",
  controlMode: "amps",
  isCharging: true,
  isPluggedIn: true,
  chargeAmps: 16,
  chargeAmpsMax: 32,
  chargeAmpsMin: 6,
  chargePowerKw: 3.8,
  chargerVoltage: 240,
  chargerPhases: 1,
  energyAddedKwh: 12.4,
  status: "charging",
  statusDetail: "Charging",
  lastUpdated: FIXED_NOW,
};

const chargerRow: ChargerRow = {
  id: "chg-1",
  name: "Garage OCPP",
  chargerAdapterType: "ocpp",
  chargerConfig: "{}",
  mode: "auto",
  priority: 1,
  vehicleId: "5YJ3E1EA7KF000001",
  kind: "smart",
  active: true,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

export const smartCharger: ChargerWithState = {
  ...chargerRow,
  state: chargerCardState,
  resolvedVehicleId: "5YJ3E1EA7KF000001",
  vehicleResolution: "linked",
  controlOwner: "self",
  passiveForVehicleId: null,
  supportsRecovery: false,
};

export const apiCharger: ChargerWithState = {
  ...smartCharger,
  id: "chg-2",
  name: "Model 3",
  // Stand-in id: the plugin-ref lint forbids naming a real plugin here.
  chargerAdapterType: "vendor-api",
  kind: "vehicle_api",
  mode: "charge_now",
  priority: 2,
  state: { ...chargerCardState, chargerId: "chg-2", status: "available" },
  controlOwner: "vehicle_api",
};

export const inactiveCharger: ChargerWithState = {
  ...smartCharger,
  id: "chg-3",
  name: "Driveway",
  active: false,
  mode: "stop",
  priority: 3,
  state: { ...chargerCardState, chargerId: "chg-3", status: "faulted" },
};

export const chargeSchedule: ChargeSchedule = {
  id: "sch-1",
  vehicleId: "5YJ3E1EA7KF000001",
  chargerId: null,
  scheduleType: "charge",
  startTime: "23:00",
  endTime: "05:30",
  days: ["mon", "tue", "wed", "thu", "fri"],
  chargeAmps: 16,
  chargeLimitPct: 80,
  enabled: true,
};

export const blockoutSchedule: Schedule = {
  id: "sch-2",
  vehicleId: null,
  chargerId: null,
  scheduleType: "blockout",
  startTime: "16:00",
  endTime: "20:00",
  days: ["sat", "sun"],
  enabled: false,
};

export const vehicles = [
  { id: "5YJ3E1EA7KF000001", name: "Model 3" },
  { id: "KMHK000000000002", name: "Ioniq 5" },
];
