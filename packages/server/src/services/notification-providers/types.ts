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

export interface ProviderConfigField {
  key: string;
  label: string;
  help: string;
  type: "text" | "toggle";
  placeholder?: string;
}

export const PROVIDER_CONFIG_FIELDS: Record<string, ProviderConfigField[]> = {
  telegram: [
    {
      key: "notificationTelegramBotToken",
      label: "Bot Token",
      help: "Create a bot via @BotFather on Telegram to get a token.",
      type: "text",
      placeholder: "123456:ABC-DEF...",
    },
    {
      key: "notificationTelegramChatId",
      label: "Chat ID",
      help: "Your user or group chat ID. Use @userinfobot to find it.",
      type: "text",
      placeholder: "-1001234567890",
    },
    {
      key: "notificationTelegramTopicId",
      label: "Topic ID (optional)",
      help:
        "For supergroups with topics enabled. Leave empty for normal chats.",
      type: "text",
      placeholder: "",
    },
    {
      key: "notificationTelegramSilent",
      label: "Send Silently",
      help: "Send notifications without sound on the recipient's device.",
      type: "toggle",
    },
  ],
};
