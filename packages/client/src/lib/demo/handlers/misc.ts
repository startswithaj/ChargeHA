import type { QueryHandler } from "./types.ts";
import { PROVIDER_CONFIG_FIELDS } from "@chargeha/shared/notifications";

export const miscHandlers: Record<string, QueryHandler> = {
  // Encryption is always "configured" in demo — no secrets to protect.
  "health.encryption": () => ({ configured: true }),
  "health.pluginWarnings": () => [],

  "notification.providers": () => PROVIDER_CONFIG_FIELDS,
};
