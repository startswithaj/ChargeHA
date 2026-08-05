import type { QueryHandler } from "./types.ts";
import type { DemoVehicle } from "../demoState.ts";
import { buildVehicleState, SYDNEY } from "./vehicleState.ts";
import { demoVehiclePluginSummaries } from "@chargeha/plugins/demoPluginSummaries";
import { geocodeAddress } from "@chargeha/shared/geocode";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** Build a vehicle.list item (VehicleRow + live charge state) from demo state. */
const toListItem = (v: DemoVehicle, now: string) => {
  const state = buildVehicleState(v, now);
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

  // Simulated plugin scoped endpoints — same builders as the main list.
  "plugin.vehicle.simulated.listVehicles": (_i, s) => {
    const now = new Date().toISOString();
    return {
      vehicles: s.vehicles
        // deno-lint-ignore custom-plugin-refs/no-plugin-refs
        .filter((v) => v.adapterType === "simulated")
        .map((v) => toListItem(v, now)),
    };
  },

  "plugin.vehicle.simulated.geocode": (input) =>
    geocodeAddress((input as { q: string }).q),
};
