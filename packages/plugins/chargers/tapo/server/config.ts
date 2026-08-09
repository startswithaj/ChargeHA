import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// Only the password is a secret (matching fronius-cloud); email is plain.

export const tapoConfigDef = defineSection({
  tapoHost: {
    key: "host",
    schema: z.string(),
    default: "",
  },
  tapoEmail: {
    key: "email",
    schema: z.string(),
    default: "",
  },
  tapoPassword: {
    key: "password",
    schema: z.string(),
    default: "",
  },
  tapoFixedDrawAmps: {
    key: "fixed_draw_amps",
    schema: z.string(),
    default: "10",
  },
  tapoDetectionThresholdW: {
    key: "detection_threshold_w",
    schema: z.string(),
    default: "100",
  },
  tapoPollIntervalSeconds: {
    key: "poll_interval_seconds",
    schema: z.string(),
    default: "10",
  },
  tapoStaleTimeoutSeconds: {
    key: "stale_timeout_seconds",
    schema: z.string(),
    default: "60",
  },
});

export type TapoConfig = SectionType<typeof tapoConfigDef>;

export type TapoConfigKey = SectionKeys<typeof tapoConfigDef>;

// Password only — email is plain config, matching fronius-cloud. Typed
// against the config keys so a rename is a compile error, not a silently
// unencrypted secret.
export const TAPO_SECRET_KEYS = [
  "password",
] as const satisfies readonly TapoConfigKey[];
