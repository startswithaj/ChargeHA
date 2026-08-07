import type { MutationHandlers } from "../types.ts";
import type {
  DemoCharger,
  DemoState,
  DemoVehicle,
  DemoVehicleMode,
} from "../../demoState.ts";
import { getDemoState, updateDemoState } from "../../demoState.ts";
import {
  linkedChargingPointId,
  linkedVehicleId,
} from "../../chargingPoints.ts";
import { emitDemoEvent } from "../../demoTick.ts";
import { demoChargerDisplayNames } from "@chargeha/plugins/demoPluginSummaries";

type ChargerMutations = Pick<
  MutationHandlers,
  | "charger.create"
  | "charger.ensure"
  | "charger.setMode"
  | "charger.setAmps"
  | "charger.reorder"
  | "charger.remove"
  | "charger.setVehicleControl"
  | "plugin.charger.simulated_charger.updateState"
>;

const CREATED_AT = "2026-01-01T00:00:00.000Z";

const nextPriority = (chargers: DemoCharger[]): number =>
  chargers.reduce((max, c) => Math.max(max, c.priority), 0) + 1;

const patchCharger = (
  chargerId: string,
  fn: (c: DemoCharger) => DemoCharger,
): DemoState =>
  updateDemoState((m) => ({
    ...m,
    chargers: m.chargers.map((c) => (c.id === chargerId ? fn(c) : c)),
  }));

const patchVehicle = (
  vehicleId: string,
  fn: (v: DemoVehicle) => DemoVehicle,
): DemoState =>
  updateDemoState((m) => ({
    ...m,
    vehicles: m.vehicles.map((v) => (v.id === vehicleId ? fn(v) : v)),
  }));

/** Whether a vehicle should be charging given a newly-set mode. */
const chargingForMode = (mode: DemoVehicleMode, current: boolean): boolean => {
  if (mode === "charge_now") return true;
  if (mode === "stop") return false;
  return current;
};

export const chargerMutations: ChargerMutations = {
  "charger.ensure": (input) => {
    const existing = getDemoState().chargers.find(
      (c) => c.chargerAdapterType === input.chargerAdapterType,
    );
    if (existing) return { id: existing.id };
    const charger: DemoCharger = {
      id: crypto.randomUUID(),
      name: demoChargerDisplayNames[input.chargerAdapterType] ??
        input.chargerAdapterType,
      chargerAdapterType: input.chargerAdapterType,
      mode: "auto",
      priority: nextPriority(getDemoState().chargers),
      vehicleId: null,
    };
    updateDemoState((m) => ({ ...m, chargers: [...m.chargers, charger] }));
    emitDemoEvent({ type: "chargers_changed", data: {} });
    return { id: charger.id };
  },

  "charger.create": (input) => {
    const charger: DemoCharger = {
      id: crypto.randomUUID(),
      name: input.name,
      chargerAdapterType: input.chargerAdapterType,
      mode: "auto",
      priority: nextPriority(getDemoState().chargers),
      vehicleId: null,
    };
    updateDemoState((m) => ({ ...m, chargers: [...m.chargers, charger] }));
    emitDemoEvent({ type: "chargers_changed", data: {} });
    return {
      id: charger.id,
      name: charger.name,
      chargerAdapterType: charger.chargerAdapterType,
      chargerConfig: "{}",
      mode: charger.mode,
      priority: charger.priority,
      vehicleId: charger.vehicleId,
      kind: "smart" as const,
      active: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
  },

  "charger.setMode": (input) => {
    const vehicleId = linkedVehicleId(input.id);
    if (vehicleId !== null) {
      patchVehicle(vehicleId, (v) => ({
        ...v,
        mode: input.mode,
        isCharging: v.isPluggedIn && chargingForMode(input.mode, v.isCharging),
      }));
    } else {
      patchCharger(input.id, (c) => ({ ...c, mode: input.mode }));
    }
    emitDemoEvent({ type: "chargers_changed", data: {} });
  },

  "charger.setAmps": (input) => {
    const vehicleId = linkedVehicleId(input.id);
    if (vehicleId !== null) {
      patchVehicle(vehicleId, (v) => ({ ...v, chargeAmps: input.amps }));
    }
    emitDemoEvent({ type: "chargers_changed", data: {} });
    return { success: true as const };
  },

  "charger.reorder": (input) => {
    updateDemoState((m) => ({
      ...m,
      chargers: m.chargers.map((c) => {
        const index = input.order.indexOf(c.id);
        return index === -1 ? c : { ...c, priority: index + 1 };
      }),
      vehicles: m.vehicles.map((v) => {
        const index = input.order.indexOf(linkedChargingPointId(v.id));
        return index === -1 ? v : { ...v, priority: index + 1 };
      }),
    }));
    emitDemoEvent({ type: "chargers_changed", data: {} });
  },

  "charger.remove": (input) => {
    updateDemoState((m) => ({
      ...m,
      chargers: m.chargers
        .filter((c) => c.id !== input.id)
        .map((c, i) => ({ ...c, priority: i + 1 })),
    }));
    emitDemoEvent({ type: "chargers_changed", data: {} });
  },

  "charger.setVehicleControl": (input) => {
    patchVehicle(input.vehicleId, (v) => ({
      ...v,
      apiControlActive: input.active,
      isCharging: input.active ? v.isCharging : false,
    }));
    emitDemoEvent({ type: "chargers_changed", data: {} });
  },

  "plugin.charger.simulated_charger.updateState": (input) => {
    const patch = (c: DemoCharger): DemoCharger => {
      if (c.chargerAdapterType !== "simulated_charger") return c;
      return {
        ...c,
        simPluggedIn: input.pluggedIn ?? c.simPluggedIn,
        simCarMaxAmps: input.carMaxAmps ?? c.simCarMaxAmps,
      };
    };
    updateDemoState((m) => ({ ...m, chargers: m.chargers.map(patch) }));
    emitDemoEvent({ type: "chargers_changed", data: {} });
  },
};
