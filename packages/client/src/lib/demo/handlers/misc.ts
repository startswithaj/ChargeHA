import type { QueryHandler } from "./types.ts";
import { PROVIDER_CONFIG_FIELDS } from "../../../../../server/src/services/notification-providers/types.ts";

export const miscHandlers: Record<string, QueryHandler> = {
  // Encryption is always "configured" in demo — no secrets to protect.
  "health.encryption": () => ({ configured: true }),
  "health.pluginWarnings": () => [],

  "notification.providers": () => PROVIDER_CONFIG_FIELDS,
};
