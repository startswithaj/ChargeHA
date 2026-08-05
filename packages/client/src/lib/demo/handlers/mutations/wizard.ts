import type { MutationHandlers } from "../types.ts";
import type { DemoCharger } from "../../demoState.ts";
import { ALL_DAYS, updateDemoState } from "../../demoState.ts";
import { emitDemoEvent } from "../../demoTick.ts";
import { demoChargerDisplayNames } from "@chargeha/plugins/demoPluginSummaries";

type WizardMutations = Pick<
  MutationHandlers,
  | "wizard.complete"
  | "wizard.demoSetup"
  | "wizard.setAuthMode"
  | "wizard.patchState"
>;

function wizardCharger(
  m: { config: Record<string, string>; chargers: DemoCharger[] },
): DemoCharger[] {
  const chargerType = m.config.wizard_charger_type;
  if (!chargerType) return [];
  if (m.chargers.some((c) => c.chargerAdapterType === chargerType)) return [];
  return [{
    id: crypto.randomUUID(),
    name: demoChargerDisplayNames[chargerType] ?? chargerType,
    chargerAdapterType: chargerType,
    mode: "auto",
    priority: m.chargers.length + 1,
    vehicleId: null,
  }];
}

export const wizardMutations: WizardMutations = {
  "wizard.complete": () => {
    updateDemoState((m) => ({
      ...m,
      // The host creates the charger row on completion (mirrors the real
      // server's ensureCharger call).
      chargers: [...m.chargers, ...wizardCharger(m)],
      config: {
        ...m.config,
        wizard_completed: "true",
        wizard_step: "",
        wizard_vehicle_type: "",
        wizard_energy_type: "",
        wizard_charger_type: "",
        wizard_control_path: "",
      },
    }));
    emitDemoEvent({ type: "chargers_changed", data: {} });
    return { completed: true };
  },

  "wizard.demoSetup": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: {
        ...m.config,
        energy_adapter_type: "simulated_energy",
        timezone: input.timezone ?? m.config.timezone,
      },
      vehicles: [{
        id: "DEMO-001",
        name: "Demo EV",
        adapterType: input.adapterType,
        priority: 1,
        mode: "auto",
        batteryCapacityKwh: 60,
        chargeLimitPercent: 80,
        socPercent: 55,
        isCharging: false,
        isPluggedIn: true,
        chargeAmps: 16,
      }],
      // Seed an overnight off-peak charge schedule so the demo shows scheduling.
      schedules: [{
        id: "demo-overnight-charge",
        vehicleId: "DEMO-001",
        chargerId: null,
        scheduleType: "charge",
        startTime: "00:00",
        endTime: "06:00",
        days: ALL_DAYS,
        chargeAmps: 16,
        chargeLimitPct: 80,
        enabled: true,
      }],
    }));
    return { success: true as const };
  },

  "wizard.setAuthMode": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, auth_mode: input.mode },
      authenticated: input.mode !== "none",
    }));
    return { success: true as const };
  },

  "wizard.patchState": (input) => {
    const patch: Record<string, string | null> = {
      ...(input.stepId !== undefined ? { wizard_step: input.stepId } : {}),
      ...(input.vehicleType !== undefined
        ? { wizard_vehicle_type: input.vehicleType }
        : {}),
      ...(input.energyType !== undefined
        ? { wizard_energy_type: input.energyType }
        : {}),
      ...(input.chargerType !== undefined
        ? { wizard_charger_type: input.chargerType }
        : {}),
      ...(input.controlPath !== undefined
        ? { wizard_control_path: input.controlPath }
        : {}),
    };
    updateDemoState((m) => {
      const merged = { ...m.config, ...patch };
      const config = Object.fromEntries(
        Object.entries(merged).filter(([, v]) => v !== null),
      ) as Record<string, string>;
      return { ...m, config };
    });
  },
};
