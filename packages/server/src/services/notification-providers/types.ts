import type { NotificationEventType } from "@chargeha/shared";

// ---- Notification Payload ----

export interface NotificationPayload {
  eventType: NotificationEventType;
  title: string;
  message: string;
  vehicleName?: string;
  vehicleId?: string;
  timestamp: Date;
}

// ---- Provider Interface ----

export interface NotificationProvider {
  /** Unique provider identifier (e.g. "telegram") */
  readonly type: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Send a notification. Throws on failure. */
  send(payload: NotificationPayload): Promise<void>;

  /** Validate that the provider is configured correctly. Returns null if OK, error message otherwise. */
  validateConfig(config: Record<string, string>): string | null;
}

// ---- Provider Config Field Definitions (for UI) ----
// Moved to @chargeha/shared so the client (settings UI + demo) can use them
// without importing server code. Re-exported here for existing server callers.
export {
  PROVIDER_CONFIG_FIELDS,
  type ProviderConfigField,
} from "@chargeha/shared/notifications";
