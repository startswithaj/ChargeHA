import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── GoodWe SEMS plugin config section ───────────────────────────────────────
// Keys are relative — PluginDependencies prefixes them with the plugin id.

export const goodweSemsConfigDef = defineSection({
  goodweSemsAccount: {
    key: "account",
    schema: z.string(),
    default: "",
  },
  goodweSemsPassword: {
    key: "password",
    schema: z.string(),
    default: "",
  },
  goodweSemsStationId: {
    key: "station_id",
    schema: z.string(),
    default: "",
  },
  goodweSemsUseSemsPlus: {
    key: "use_sems_plus",
    schema: z.boolean(),
    default: false,
  },
});

export type GoodweSemsConfig = SectionType<typeof goodweSemsConfigDef>;

export type GoodweSemsConfigKey = SectionKeys<typeof goodweSemsConfigDef>;

export const GOODWE_SEMS_SECRET_KEYS: readonly GoodweSemsConfigKey[] = [
  "password",
] as const satisfies readonly GoodweSemsConfigKey[];
