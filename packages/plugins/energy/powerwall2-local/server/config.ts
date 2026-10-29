import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

export const DEFAULT_POWERWALL_MAX_STALENESS_SECONDS = 60;
export const DEFAULT_POWERWALL_POLL_INTERVAL_SECONDS = 30;
export const pollIntervalSchema = z.string().refine(
  (raw) =>
    Number.isInteger(Number(raw)) && Number(raw) >= 10 && Number(raw) <= 60,
  "Powerwall poll interval must be 10-60 whole seconds",
);

// A hostname only: never accept URL credentials, paths or an alternate port.
export const gatewayHostSchema = z.string().trim().min(1).regex(
  /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/,
  "Enter the Gateway IP address or hostname without https://, port or path",
);
export const freshnessSchema = z.string().refine(
  (raw) =>
    Number.isFinite(Number(raw)) && Number(raw) >= 10 && Number(raw) <= 300,
  "Powerwall telemetry freshness must be 10-300 seconds",
);

export const powerwall2LocalConfigDef = defineSection({
  host: {
    key: "host",
    schema: gatewayHostSchema,
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
  pollIntervalSeconds: {
    key: "poll_interval_seconds",
    schema: pollIntervalSchema,
    default: String(DEFAULT_POWERWALL_POLL_INTERVAL_SECONDS),
  },
  maxStalenessSeconds: {
    key: "max_staleness_seconds",
    schema: freshnessSchema,
    default: String(DEFAULT_POWERWALL_MAX_STALENESS_SECONDS),
  },
});

export type Powerwall2LocalConfig = SectionType<
  typeof powerwall2LocalConfigDef
>;

export type Powerwall2LocalConfigKey = SectionKeys<
  typeof powerwall2LocalConfigDef
>;

export const POWERWALL2_LOCAL_SECRET_KEYS: readonly Powerwall2LocalConfigKey[] =
  [
    "password",
  ] as const satisfies readonly Powerwall2LocalConfigKey[];

export function parseMaxStalenessSeconds(raw: string | null): number {
  return Number(freshnessSchema.parse(
    raw ?? String(DEFAULT_POWERWALL_MAX_STALENESS_SECONDS),
  ));
}

export function parsePollIntervalSeconds(raw: string | null): number {
  return Number(
    pollIntervalSchema.parse(
      raw ?? String(DEFAULT_POWERWALL_POLL_INTERVAL_SECONDS),
    ),
  );
}
