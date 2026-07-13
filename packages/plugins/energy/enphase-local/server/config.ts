import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Enphase Local plugin config section ─────────────────────────────────────
// All keys use dot-namespaced format: enphase_local.{key}
//
// The Envoy (IQ Gateway) serves its local API over HTTPS with a self-signed
// certificate. Firmware 7+ requires a JWT owner token obtained from Enphase's
// cloud: either fetched automatically with the account email/password, or
// pasted manually by the user. `token` caches whichever token is in use.

export const enphaseLocalConfigDef = defineSection({
  host: {
    key: "enphase_local.host",
    schema: z.string(),
    default: "",
  },
  serial: {
    key: "enphase_local.serial",
    schema: z.string(),
    default: "",
  },
  email: {
    key: "enphase_local.email",
    schema: z.string(),
    default: "",
  },
  password: {
    key: "enphase_local.password",
    schema: z.string(),
    default: "",
  },
  token: {
    key: "enphase_local.token",
    schema: z.string(),
    default: "",
  },
});

export type EnphaseLocalConfig = SectionType<typeof enphaseLocalConfigDef>;

export type EnphaseLocalConfigKey = SectionKeys<typeof enphaseLocalConfigDef>;

export const ENPHASE_LOCAL_SECRET_KEYS: readonly EnphaseLocalConfigKey[] = [
  "enphase_local.password",
  "enphase_local.token",
] as const satisfies readonly EnphaseLocalConfigKey[];
