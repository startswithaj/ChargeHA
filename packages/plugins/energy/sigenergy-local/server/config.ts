import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// Sigenergy config — keys are relative; Modbus TCP with no auth, defaults match factory settings.

export const SIGENERGY_DEFAULTS = {
  port: 502,
  plantUnitId: 247,
  deviceUnitId: 1,
} as const;

export const sigenergyLocalConfigDef = defineSection({
  host: {
    key: "host",
    schema: z.string(),
    default: "",
  },
  port: {
    key: "port",
    schema: z.string(),
    default: String(SIGENERGY_DEFAULTS.port),
  },
  plantUnitId: {
    key: "plant_unit_id",
    schema: z.string(),
    default: String(SIGENERGY_DEFAULTS.plantUnitId),
  },
  deviceUnitId: {
    key: "device_unit_id",
    schema: z.string(),
    default: String(SIGENERGY_DEFAULTS.deviceUnitId),
  },
});

export type SigenergyLocalConfig = SectionType<typeof sigenergyLocalConfigDef>;

export type SigenergyLocalConfigKey = SectionKeys<
  typeof sigenergyLocalConfigDef
>;
