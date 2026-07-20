import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// Enphase Local config — keys are relative; firmware 7+ needs a JWT owner token from Enphase cloud.

export const enphaseLocalConfigDef = defineSection({
  host: {
    key: "host",
    schema: z.string(),
    default: "",
  },
  email: {
    key: "email",
    schema: z.string(),
    default: "",
  },
  password: {
    key: "password",
    schema: z.string(),
    default: "",
  },
  token: {
    key: "token",
    schema: z.string(),
    default: "",
  },
});

export type EnphaseLocalConfig = SectionType<typeof enphaseLocalConfigDef>;

export type EnphaseLocalConfigKey = SectionKeys<typeof enphaseLocalConfigDef>;

export const ENPHASE_LOCAL_SECRET_KEYS: readonly EnphaseLocalConfigKey[] = [
  "password",
  "token",
] as const satisfies readonly EnphaseLocalConfigKey[];
