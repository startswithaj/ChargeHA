import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Sigenergy plugin config section ─────────────────────────────────────────
// All keys use dot-namespaced format: sigenergy_local.{key}
//
// Sigenergy inverters expose a Modbus TCP interface with no authentication.
// `host` is required; the rest have sensible defaults matching Sigenergy's
// factory settings (port 502, plant/EMS unit id 247, device unit id 1) and are
// surfaced as advanced fields for non-standard installations.

export const sigenergyLocalConfigDef = defineSection({
  host: {
    key: "sigenergy_local.host",
    schema: z.string(),
    default: "",
  },
  port: {
    key: "sigenergy_local.port",
    schema: z.string(),
    default: "502",
  },
  plantUnitId: {
    key: "sigenergy_local.plant_unit_id",
    schema: z.string(),
    default: "247",
  },
  deviceUnitId: {
    key: "sigenergy_local.device_unit_id",
    schema: z.string(),
    default: "1",
  },
});

export type SigenergyLocalConfig = SectionType<typeof sigenergyLocalConfigDef>;

export type SigenergyLocalConfigKey = SectionKeys<
  typeof sigenergyLocalConfigDef
>;
