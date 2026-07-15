import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Enphase Local plugin config section ─────────────────────────────────────
// Keys are relative — PluginDependencies prefixes them with the plugin id.
//
// The Envoy (IQ Gateway) serves its local API over HTTPS with a self-signed
// certificate. Firmware 7+ requires a JWT owner token obtained from Enphase's
// cloud: either fetched automatically with the account email/password, or
// pasted manually by the user. `token` caches whichever token is in use.

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
