import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Fronius Cloud plugin config section ─────────────────────────────────────
// All keys use dot-namespaced format: fronius_cloud.{key}

export const froniusCloudConfigDef = defineSection({
  froniusCloudEmail: {
    key: "fronius_cloud.email",
    schema: z.string(),
    default: "",
  },
  froniusCloudPassword: {
    key: "fronius_cloud.password",
    schema: z.string(),
    default: "",
  },
  froniusCloudPvSystemId: {
    key: "fronius_cloud.pv_system_id",
    schema: z.string(),
    default: "",
  },
});

export type FroniusCloudConfig = SectionType<typeof froniusCloudConfigDef>;

export type FroniusCloudConfigKey = SectionKeys<typeof froniusCloudConfigDef>;

export const FRONIUS_CLOUD_SECRET_KEYS: readonly FroniusCloudConfigKey[] = [
  "fronius_cloud.password",
] as const satisfies readonly FroniusCloudConfigKey[];
