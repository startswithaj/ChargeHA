import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Fronius Local plugin config section ─────────────────────────────────────
// Keys are relative — PluginDependencies prefixes them with the plugin id.

export const froniusLocalConfigDef = defineSection({
  froniusHost: {
    key: "host",
    schema: z.string(),
    default: "",
  },
  froniusMeterDeviceId: {
    key: "meter_device_id",
    schema: z.string(),
    default: "0",
  },
});

export type FroniusLocalConfig = SectionType<typeof froniusLocalConfigDef>;

export type FroniusLocalConfigKey = SectionKeys<typeof froniusLocalConfigDef>;
