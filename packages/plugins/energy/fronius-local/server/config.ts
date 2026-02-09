import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Fronius Local plugin config section ─────────────────────────────────────
// All keys use dot-namespaced format: fronius_local.{key}

export const froniusLocalConfigDef = defineSection({
  froniusHost: {
    key: "fronius_local.host",
    schema: z.string(),
    default: "",
  },
  froniusMeterDeviceId: {
    key: "fronius_local.meter_device_id",
    schema: z.string(),
    default: "0",
  },
});

export type FroniusLocalConfig = SectionType<typeof froniusLocalConfigDef>;

export type FroniusLocalConfigKey = SectionKeys<typeof froniusLocalConfigDef>;
