import type { AppDatabase } from "../../db/AppDatabase.ts";
import type { NotificationPayload, NotificationProvider } from "./types.ts";

const EMOJI: Record<string, string> = {
  error: "\u274C",
  energy_recovered: "\u2705",
  charge_started: "\u26A1",
  charge_stopped: "\u23F9\uFE0F",
  charge_complete: "\u2705",
  external_charge_detected: "\u2753",
  vehicle_plugged_in: "\uD83D\uDD0C",
  vehicle_unplugged: "\uD83D\uDD0C",
  vehicle_sleep: "\uD83D\uDCA4",
  low_solar: "\u2601\uFE0F",
  schedule_activated: "\uD83D\uDCC5",
  safety_trip: "\uD83D\uDEA8",
  arrived_home_not_plugged_in: "\uD83E\uDEAB",
};

export class TelegramProvider implements NotificationProvider {
  readonly type = "telegram";
  readonly displayName = "Telegram";

  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const botToken = await this.db.getConfig(
      "notification_telegram_bot_token",
    );
    const chatId = await this.db.getConfig("notification_telegram_chat_id");

    if (!botToken || !chatId) {
      throw new Error("Telegram bot token or chat ID not configured");
    }

    const topicId = await this.db.getConfig(
      "notification_telegram_topic_id",
    );
    const silent =
      (await this.db.getConfig("notification_telegram_silent")) === "true";

    const emoji = EMOJI[payload.eventType] ?? "\uD83D\uDD14";
    const lines = [
      `${emoji} <b>${this.escapeHtml(payload.title)}</b>`,
      "",
      this.escapeHtml(payload.message),
    ];
    if (payload.vehicleName) {
      lines.push("");
      lines.push(`\uD83D\uDE97 ${this.escapeHtml(payload.vehicleName)}`);
    }

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_notification: silent,
    };

    if (topicId) {
      body.message_thread_id = parseInt(topicId, 10);
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Telegram API error ${res.status}: ${text}`);
    }
  }

  validateConfig(config: Record<string, string>): string | null {
    if (!config.notificationTelegramBotToken) {
      return "Bot token is required";
    }
    if (!config.notificationTelegramChatId) {
      return "Chat ID is required";
    }
    return null;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
