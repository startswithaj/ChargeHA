import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// Sigenergy config — keys are relative; Modbus TCP with no auth, defaults match factory settings.

export const sigenergyLocalConfigDef = defineSection({
  host: {
    key: "host",
    schema: z.string(),
    default: "",
  },
  port: {
    key: "port",
    schema: z.string(),
    default: "502",
  },
  plantUnitId: {
    key: "plant_unit_id",
    schema: z.string(),
    default: "247",
  },
  deviceUnitId: {
    key: "device_unit_id",
    schema: z.string(),
    default: "1",
  },
});

export type SigenergyLocalConfig = SectionType<typeof sigenergyLocalConfigDef>;

export type SigenergyLocalConfigKey = SectionKeys<
  typeof sigenergyLocalConfigDef
>;
