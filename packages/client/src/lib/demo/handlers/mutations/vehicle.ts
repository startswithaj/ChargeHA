import type { MutationHandlers } from "../types.ts";
import type { DemoState, DemoVehicle } from "../../demoState.ts";
import { getDemoState, updateDemoState } from "../../demoState.ts";
import { emitDemoEvent } from "../../demoTick.ts";
import { buildVehicleState } from "../vehicleState.ts";

type VehicleMutations = Pick<
  MutationHandlers,
  | "vehicle.create"
  | "vehicle.delete"
  | "vehicle.setPriority"
  | "vehicle.command"
  | "vehicle.refreshState"
  | "plugin.vehicle.simulated.updateState"
  | "plugin.vehicle.simulated_dataonly.updateState"
>;

const stateOf = (s: DemoState, vehicleId: string) => {
  const v = s.vehicles.find((x) => x.id === vehicleId);
  return v ? buildVehicleState(v, new Date().toISOString()) : null;
};

const patchVehicle = (
  vehicleId: string,
  fn: (v: DemoVehicle) => DemoVehicle,
): DemoState =>
  updateDemoState((m) => ({
    ...m,
    vehicles: m.vehicles.map((v) => (v.id === vehicleId ? fn(v) : v)),
  }));

const nextPriority = (vehicles: DemoVehicle[]): number =>
  vehicles.reduce((max, v) => Math.max(max, v.priority), 0) + 1;

const parseConfig = (
  config: string | undefined,
): { batteryCapacityKwh?: number; chargeLimitPercent?: number } => {
  try {
    return config ? JSON.parse(config) : {};
  } catch (error) {
    console.warn("Demo: ignoring malformed vehicle config", error);
    return {};
  }
};

export const vehicleMutations: VehicleMutations = {
  "vehicle.create": (input) => {
    const cfg = parseConfig(input.config);
    const priority = input.priority ?? nextPriority(getDemoState().vehicles);
    const mode = input.mode ?? "auto";
    updateDemoState((m) => ({
      ...m,
      vehicles: [...m.vehicles, {
        id: input.id,
        name: input.name,
        adapterType: input.adapterType,
        priority,
        mode,
        batteryCapacityKwh: cfg.batteryCapacityKwh ?? 60,
        chargeLimitPercent: cfg.chargeLimitPercent ?? 80,
        socPercent: 55,
        isCharging: false,
        isPluggedIn: true,
        chargeAmps: 16,
      }],
    }));
    emitDemoEvent({ type: "vehicles_changed", data: {} });
    emitDemoEvent({ type: "chargers_changed", data: {} });
    return {
      success: true,
      vehicle: {
        id: input.id,
        name: input.name,
        adapterType: input.adapterType,
        priority,
        config: input.config ?? "{}",
        mode,
      },
    };
  },

  "vehicle.delete": (input) => {
    updateDemoState((m) => ({
      ...m,
      vehicles: m.vehicles.filter((v) => v.id !== input.vehicleId),
      schedules: m.schedules.filter((s) => s.vehicleId !== input.vehicleId),
    }));
    emitDemoEvent({ type: "vehicles_changed", data: {} });
    emitDemoEvent({ type: "chargers_changed", data: {} });
    return { success: true };
  },

  "vehicle.setPriority": (input) => {
    patchVehicle(input.vehicleId, (v) => ({ ...v, priority: input.priority }));
    return { success: true, priority: input.priority };
  },

  "vehicle.command": (input) => ({
    success: true,
    state: stateOf(getDemoState(), input.vehicleId),
  }),

  "vehicle.refreshState": (input) => ({
    state: stateOf(getDemoState(), input.vehicleId),
  }),

  "plugin.vehicle.simulated_dataonly.updateState": (input) =>
    vehicleMutations["plugin.vehicle.simulated.updateState"](input),

  "plugin.vehicle.simulated.updateState": (input) => {
    const next = patchVehicle(input.vehicleId, (v) => ({
      ...v,
      isPluggedIn: input.isPluggedIn ?? v.isPluggedIn,
      chargeLimitPercent: input.chargeLimit ?? v.chargeLimitPercent,
      socPercent: input.socPercent != null
        ? Math.max(0, Math.min(100, input.socPercent))
        : v.socPercent,
    }));
    return { success: true, state: stateOf(next, input.vehicleId) };
  },
};
