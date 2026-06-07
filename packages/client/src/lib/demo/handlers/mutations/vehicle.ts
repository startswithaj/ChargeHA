import type { MutationHandlers } from "../types.ts";
import type {
  DemoState,
  DemoVehicle,
  DemoVehicleMode,
} from "../../demoState.ts";
import { getDemoState, updateDemoState } from "../../demoState.ts";
import { buildVehicleState } from "../vehicleState.ts";

type VehicleMutations = Pick<
  MutationHandlers,
  | "vehicle.create"
  | "vehicle.delete"
  | "vehicle.setMode"
  | "vehicle.setPriority"
  | "vehicle.command"
  | "vehicle.setAmps"
  | "vehicle.refreshState"
  | "simulated.updateState"
>;

/** The live state of a vehicle after a mutation, or null if it's gone. */
const stateOf = (s: DemoState, vehicleId: string) => {
  const v = s.vehicles.find((x) => x.id === vehicleId);
  return v ? buildVehicleState(v, new Date().toISOString()) : null;
};

/** Replace one vehicle by id via a pure mapper, persisting the change. */
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
  } catch {
    return {};
  }
};

/** Whether a vehicle should be charging given a newly-set mode. */
const chargingForMode = (mode: DemoVehicleMode, current: boolean): boolean => {
  if (mode === "charge_now") return true;
  if (mode === "stop") return false;
  return current;
};

/** Apply a start/stop/wake command (wake is a no-op). "start" forces charging
 *  via charge_now so the live controller keeps it on; "stop" idles it. */
const applyCommand = (
  v: DemoVehicle,
  command: "start" | "stop" | "wake",
): DemoVehicle => {
  if (command === "start") {
    return { ...v, isCharging: true, mode: "charge_now" };
  }
  if (command === "stop") return { ...v, isCharging: false, mode: "stop" };
  return v;
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
    return { success: true };
  },

  "vehicle.setMode": (input) => {
    patchVehicle(input.vehicleId, (v) => ({
      ...v,
      mode: input.mode,
      isCharging: chargingForMode(input.mode, v.isCharging),
    }));
    return { success: true, mode: input.mode };
  },

  "vehicle.setPriority": (input) => {
    patchVehicle(input.vehicleId, (v) => ({ ...v, priority: input.priority }));
    return { success: true, priority: input.priority };
  },

  "vehicle.command": (input) => {
    const next = patchVehicle(
      input.vehicleId,
      (v) => applyCommand(v, input.command),
    );
    return { success: true, state: stateOf(next, input.vehicleId) };
  },

  "vehicle.setAmps": (input) => {
    const next = patchVehicle(input.vehicleId, (v) => ({
      ...v,
      chargeAmps: input.amps,
      isCharging: true,
    }));
    return { success: true, state: stateOf(next, input.vehicleId) };
  },

  "vehicle.refreshState": (input) => ({
    state: stateOf(getDemoState(), input.vehicleId),
  }),

  "simulated.updateState": (input) => {
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
