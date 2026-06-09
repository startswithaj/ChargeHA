import type { MutationHandlers } from "../types.ts";
import { updateDemoState } from "../../demoState.ts";
import {
  batteryConfigDef,
  chargingConfigDef,
  equipmentConfigDef,
  homeConfigDef,
  notificationConfigDef,
  serializeSection,
  solarConfigDef,
  systemConfigDef,
} from "@chargeha/shared/configSections";

type ConfigMutations = Pick<
  MutationHandlers,
  | "config.charging.set"
  | "config.solar.set"
  | "config.battery.set"
  | "config.home.set"
  | "config.equipment.set"
  | "config.system.set"
  | "config.notification.set"
  | "config.set"
  | "config.dismissSystemAlert"
>;

/** Serialize a section partial onto the raw config map (mirrors the server). */
const mergeSection = (raw: Record<string, string>) =>
  updateDemoState((m) => ({ ...m, config: { ...m.config, ...raw } }));

export const configMutations: ConfigMutations = {
  "config.charging.set": (input) => {
    mergeSection(serializeSection(chargingConfigDef, input));
  },
  "config.solar.set": (input) => {
    mergeSection(serializeSection(solarConfigDef, input));
  },
  "config.battery.set": (input) => {
    mergeSection(serializeSection(batteryConfigDef, input));
  },
  "config.home.set": (input) => {
    mergeSection(serializeSection(homeConfigDef, input));
  },
  "config.equipment.set": (input) => {
    mergeSection(serializeSection(equipmentConfigDef, input));
  },
  "config.system.set": (input) => {
    mergeSection(serializeSection(systemConfigDef, input));
  },
  "config.notification.set": (input) => {
    mergeSection(serializeSection(notificationConfigDef, input));
  },

  "config.set": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, [input.key]: input.value },
    }));
    return { key: input.key, value: input.value };
  },

  "config.dismissSystemAlert": () => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, systemAlert: "" },
    }));
    return { success: true };
  },
};
