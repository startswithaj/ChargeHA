import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Sigenergy plugin config section ─────────────────────────────────────────
// All keys use dot-namespaced format: sigenergy.{key}
//
// Sigenergy inverters expose a Modbus TCP interface with no authentication.
// `host` is required; the rest have sensible defaults matching Sigenergy's
// factory settings (port 502, plant/EMS unit id 247, device unit id 1) and are
// surfaced as advanced fields for non-standard installations.

export const sigenergyConfigDef = defineSection({
  host: {
    key: "sigenergy.host",
    schema: z.string(),
    default: "",
  },
  port: {
    key: "sigenergy.port",
    schema: z.string(),
    default: "502",
  },
  plantUnitId: {
    key: "sigenergy.plant_unit_id",
    schema: z.string(),
    default: "247",
  },
  deviceUnitId: {
    key: "sigenergy.device_unit_id",
    schema: z.string(),
    default: "1",
  },
});

export type SigenergyConfig = SectionType<typeof sigenergyConfigDef>;

export type SigenergyConfigKey = SectionKeys<typeof sigenergyConfigDef>;
