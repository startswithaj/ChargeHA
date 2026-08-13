import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

export const ocppConfigDef = defineSection({
  ocppChargerId: {
    key: "charger_id",
    // Goes into the websocket URL path, which OCPP-J requires to be
    // percent-encoded per RFC3986 — restricting the charset avoids needing to.
    // Nullable: the id is compared for equality against what a charge point
    // announces, so a stored "" would look configured and match nothing.
    schema: z.string().regex(
      /^[A-Za-z0-9._~-]+$/,
      "Letters, numbers, dots, dashes and underscores only",
    ).nullable(),
    default: null,
  },
  ocppMeterTimeoutSeconds: {
    key: "meter_timeout_seconds",
    schema: z.string(),
    default: "300",
  },
  // Charger amp range — defaults follow the HA integration's convention
  // (32A max) and the J1772 pilot floor (6A). User-adjustable in settings.
  ocppMaxAmps: {
    key: "max_amps",
    schema: z.string(),
    default: "32",
  },
  ocppMinAmps: {
    key: "min_amps",
    schema: z.string(),
    default: "6",
  },
  // Per-charger phase count (a plug is 1; a 3-phase wall charger is 3).
  // Used for the watts → amps derivation; the charger cannot report it.
  ocppPhases: {
    key: "phases",
    schema: z.enum(["1", "3"]),
    default: "1",
  },
});

export type OcppConfig = SectionType<typeof ocppConfigDef>;
export type OcppConfigKey = SectionKeys<typeof ocppConfigDef>;

// Typed against the config keys so a rename is a compile error, not a
// silently unencrypted secret (fronius-cloud pattern).
// OCPP stores no secrets. Kept so the plugin contract is explicit.
export const OCPP_SECRET_KEYS = [] as const satisfies readonly OcppConfigKey[];
