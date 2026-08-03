import type { MutationHandlers } from "../types.ts";
import type { DemoCharger, DemoState } from "../../demoState.ts";
import { getDemoState, updateDemoState } from "../../demoState.ts";

type ChargerMutations = Pick<
  MutationHandlers,
  | "charger.create"
  | "charger.ensure"
  | "charger.setMode"
  | "charger.setAmps"
  | "charger.reorder"
  | "charger.remove"
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

export const chargerMutations: ChargerMutations = {
  "charger.ensure": (input) => {
    const exists = getDemoState().chargers.some(
      (c) => c.chargerAdapterType === input.chargerAdapterType,
    );
    if (exists) return;
    const charger: DemoCharger = {
      id: crypto.randomUUID(),
      name: input.chargerAdapterType,
      chargerAdapterType: input.chargerAdapterType,
      mode: "auto",
      priority: nextPriority(getDemoState().chargers),
      vehicleId: null,
    };
    updateDemoState((m) => ({ ...m, chargers: [...m.chargers, charger] }));
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
    return {
      id: charger.id,
      name: charger.name,
      chargerAdapterType: charger.chargerAdapterType,
      chargerConfig: "{}",
      mode: charger.mode,
      priority: charger.priority,
      vehicleId: charger.vehicleId,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
  },

  "charger.setMode": (input) => {
    patchCharger(input.id, (c) => ({ ...c, mode: input.mode }));
  },

  "charger.setAmps": () => ({ success: true as const }),

  "charger.reorder": (input) => {
    updateDemoState((m) => ({
      ...m,
      chargers: m.chargers.map((c) => {
        const index = input.order.indexOf(c.id);
        return index === -1 ? c : { ...c, priority: index + 1 };
      }),
    }));
  },

  "charger.remove": (input) => {
    updateDemoState((m) => ({
      ...m,
      chargers: m.chargers
        .filter((c) => c.id !== input.id)
        .map((c, i) => ({ ...c, priority: i + 1 })),
    }));
  },
};
