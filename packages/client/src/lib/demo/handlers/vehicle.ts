import type { QueryHandler } from "./types.ts";
import type { DemoVehicle } from "../demoState.ts";
import { demoVehiclePluginSummaries } from "@chargeha/plugins/demoPluginSummaries";

const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
const VOLTAGE = 230;
const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** Build a vehicle.list item (VehicleRow + live charge state) from demo state. */
const toListItem = (v: DemoVehicle, now: string) => {
  const state = {
    vehicleId: v.id,
    batteryLevel: v.socPercent,
    chargeLimit: v.chargeLimitPercent,
    isCharging: v.isCharging,
    isPluggedIn: v.isPluggedIn,
    isOnline: true,
    chargeAmps: v.isCharging ? v.chargeAmps : 0,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: v.isCharging ? (v.chargeAmps * VOLTAGE) / 1000 : 0,
    chargerVoltage: VOLTAGE,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: v.isPluggedIn,
    vehicleName: v.name,
    lastUpdated: now,
    latitude: SYDNEY.latitude,
    longitude: SYDNEY.longitude,
    isHome: true,
  };
  return {
    id: v.id,
    name: v.name,
    adapterType: v.adapterType,
    priority: v.priority,
    config: JSON.stringify({
      batteryCapacityKwh: v.batteryCapacityKwh,
      chargeLimitPercent: v.chargeLimitPercent,
      vehicleName: v.name,
    }),
    mode: v.mode,
    createdAt: CREATED_AT,
    updatedAt: now,
    state,
    lastLocation: { latitude: SYDNEY.latitude, longitude: SYDNEY.longitude },
    lastError: null,
    lastErrorAt: null,
  };
};

export const vehicleHandlers: Record<string, QueryHandler> = {
  // Simulated vehicles are always commandable in demo.
  "vehicle.commandStatus": () => ({ commandsDisabled: false, reason: null }),

  "vehicle.list": (_i, s) => {
    const now = new Date().toISOString();
    return { vehicles: s.vehicles.map((v) => toListItem(v, now)) };
  },

  "vehicle.getPlugins": (_i, s) =>
    demoVehiclePluginSummaries.map((p) => ({
      ...p,
      configured: s.vehicles.some((v) => v.adapterType === p.id),
    })),
};
