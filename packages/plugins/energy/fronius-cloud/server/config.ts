import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Fronius Cloud plugin config section ─────────────────────────────────────
// Keys are relative — PluginDependencies prefixes them with the plugin id.

export const froniusCloudConfigDef = defineSection({
  froniusCloudEmail: {
    key: "email",
    schema: z.string(),
    default: "",
  },
  froniusCloudPassword: {
    key: "password",
    schema: z.string(),
    default: "",
  },
  froniusCloudPvSystemId: {
    key: "pv_system_id",
    schema: z.string(),
    default: "",
  },
});

export type FroniusCloudConfig = SectionType<typeof froniusCloudConfigDef>;

export type FroniusCloudConfigKey = SectionKeys<typeof froniusCloudConfigDef>;

export const FRONIUS_CLOUD_SECRET_KEYS: readonly FroniusCloudConfigKey[] = [
  "password",
] as const satisfies readonly FroniusCloudConfigKey[];
