import type { AppDatabase } from "../db/AppDatabase.ts";
import { notificationConfigDef } from "@chargeha/shared/configSections";
import type { Logger } from "../lib/Logger.ts";
import type { NotificationEventType } from "@chargeha/shared";
import {
  type NotificationPayload,
  type NotificationProvider,
  PROVIDER_CONFIG_FIELDS,
} from "./notification-providers/types.ts";

/** Maps typed prop names (e.g. "notificationTelegramBotToken") to their DB
 *  key literal (e.g. "notification_telegram_bot_token"). Both sides are
 *  derived from notificationConfigDef so renames stay in sync. */
type NotificationPropToKey = {
  [P in keyof typeof notificationConfigDef]: typeof notificationConfigDef[P][
    "key"
  ];
};
const PROP_TO_DB_KEY = Object.fromEntries(
  Object.entries(notificationConfigDef).map(([prop, def]) => [prop, def.key]),
) as NotificationPropToKey;

export class NotificationService {
  private readonly db: AppDatabase;
  private readonly logger: Logger;
  private providers = new Map<string, NotificationProvider>();

  constructor(
    db: AppDatabase,
    providers: NotificationProvider[],
    logger: Logger,
  ) {
    this.db = db;
    this.logger = logger;
    providers.forEach((provider) => {
      this.providers.set(provider.type, provider);
      this.logger.info(`Registered provider: ${provider.displayName}`);
    });
  }

  /**
   * Send a notification. Safe to call from anywhere — failures never propagate.
   */
  async notify(
    eventType: NotificationEventType,
    title: string,
    message: string,
    opts?: { vehicleName?: string; vehicleId?: string },
  ): Promise<void> {
    try {
      // Check if notifications are enabled for this event
      const providerType = await this.db.getConfig("notification_provider");
      if (!providerType) return;

      const enabledEventsRaw = await this.db.getConfig(
        "notification_enabled_events",
      );
      if (!enabledEventsRaw) return;

      const enabledEvents = enabledEventsRaw.split(",").map((s) => s.trim());
      if (!enabledEvents.includes(eventType)) return;

      const provider = this.providers.get(providerType);
      if (!provider) {
        this.logger.warn(`Unknown provider: ${providerType}`);
        return;
      }

      const payload: NotificationPayload = {
        eventType,
        title,
        message,
        vehicleName: opts?.vehicleName,
        vehicleId: opts?.vehicleId,
        timestamp: new Date(),
      };

      await provider.send(payload);

      this.logger.info(`Sent ${eventType} via ${providerType}`);
    } catch (error) {
      this.logger.error("Failed to send notification:", error);
    }
  }

  /**
   * Send a test notification. Bypasses event checks.
   */
  async sendTest(): Promise<void> {
    const providerType = await this.db.getConfig("notification_provider");
    if (!providerType) {
      throw new Error("No notification provider configured");
    }

    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerType}`);
    }

    // Validate config before sending
    const fields = PROVIDER_CONFIG_FIELDS[providerType] ?? [];
    const configEntries = await Promise.all(
      fields
        .filter((
          field,
        ): field is typeof field & { key: keyof NotificationPropToKey } =>
          field.key in PROP_TO_DB_KEY
        )
        .map(async (field) => {
          const dbKey = PROP_TO_DB_KEY[field.key];
          const val = await this.db.getConfig(dbKey);
          return val ? [field.key, val] as const : null;
        }),
    );
    const configForValidation: Record<string, string> = Object.fromEntries(
      configEntries.filter((e) => e !== null),
    );

    const validationError = provider.validateConfig(configForValidation);
    if (validationError) {
      throw new Error(validationError);
    }

    const payload: NotificationPayload = {
      eventType: "charge_started",
      title: "Test Notification",
      message:
        "If you're reading this, ChargeHA notifications are working correctly!",
      timestamp: new Date(),
    };

    await provider.send(payload);
  }

  getProviderTypes(): string[] {
    return [...this.providers.keys()];
  }
}
