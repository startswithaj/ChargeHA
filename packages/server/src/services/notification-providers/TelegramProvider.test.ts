import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import type { NotificationPayload } from "./types.ts";
import { TelegramProvider } from "./TelegramProvider.ts";

describe("TelegramProvider", () => {
  const extractUrl = (input: string | URL | Request): string => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  };

  const TEST_PAYLOAD: NotificationPayload = {
    eventType: "charge_started",
    title: "Charging Started",
    message: "Vehicle is now charging",
    timestamp: new Date("2026-01-01T12:00:00Z"),
  };

  type FetchMock = {
    calls: Array<{ url: string; init?: RequestInit }>;
    setResponse: (response: Response) => void;
    restore: () => void;
  };

  const installFetchMock = (): FetchMock => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let response = new Response('{"ok":true}', { status: 200 });
    const original = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: extractUrl(input), init });
      return Promise.resolve(response.clone());
    }) as typeof globalThis.fetch;
    return {
      calls,
      setResponse: (r) => {
        response = r;
      },
      restore: () => {
        globalThis.fetch = original;
      },
    };
  };

  type ConfigureOpts = {
    token?: string;
    chatId?: string;
    topicId?: string;
    silent?: boolean;
  };

  const setupTelegram = async () => {
    const db = new AppDatabase(":memory:");
    await db.init();
    const provider = new TelegramProvider(db);
    const fetchMock = installFetchMock();

    const configure = async (
      opts: ConfigureOpts = { token: "123:ABC", chatId: "-1001234" },
    ) => {
      if (opts.token !== undefined) {
        await db.setConfig("notification_telegram_bot_token", opts.token);
      }
      if (opts.chatId !== undefined) {
        await db.setConfig("notification_telegram_chat_id", opts.chatId);
      }
      if (opts.topicId !== undefined) {
        await db.setConfig("notification_telegram_topic_id", opts.topicId);
      }
      if (opts.silent !== undefined) {
        await db.setConfig(
          "notification_telegram_silent",
          String(opts.silent),
        );
      }
    };

    return { db, provider, fetchMock, configure };
  };

  let harness: Awaited<ReturnType<typeof setupTelegram>>;

  beforeEach(async () => {
    harness = await setupTelegram();
  });

  afterEach(() => {
    harness.fetchMock.restore();
    harness.db.close();
  });

  describe("type and displayName", () => {
    it("has correct type", () => {
      expect(harness.provider.type).toBe("telegram");
    });

    it("has correct displayName", () => {
      expect(harness.provider.displayName).toBe("Telegram");
    });
  });

  describe("validateConfig", () => {
    it("returns null when both token and chat ID are present", () => {
      const result = harness.provider.validateConfig({
        notificationTelegramBotToken: "123:ABC",
        notificationTelegramChatId: "-1001234",
      });
      expect(result).toBeNull();
    });

    it("returns error when bot token is missing", () => {
      const result = harness.provider.validateConfig({
        notificationTelegramChatId: "-1001234",
      });
      expect(result).toBe("Bot token is required");
    });

    it("returns error when chat ID is missing", () => {
      const result = harness.provider.validateConfig({
        notificationTelegramBotToken: "123:ABC",
      });
      expect(result).toBe("Chat ID is required");
    });
  });

  describe("send", () => {
    it("throws when bot token is not configured", async () => {
      await harness.configure({ chatId: "-1001234" });
      await expect(harness.provider.send(TEST_PAYLOAD)).rejects.toThrow(
        "bot token or chat ID not configured",
      );
    });

    it("throws when chat ID is not configured", async () => {
      await harness.configure({ token: "123:ABC" });
      await expect(harness.provider.send(TEST_PAYLOAD)).rejects.toThrow(
        "bot token or chat ID not configured",
      );
    });

    it("sends POST to Telegram API with correct URL", async () => {
      await harness.configure();

      await harness.provider.send(TEST_PAYLOAD);

      expect(harness.fetchMock.calls).toHaveLength(1);
      expect(harness.fetchMock.calls[0].url).toBe(
        "https://api.telegram.org/bot123:ABC/sendMessage",
      );
      expect(harness.fetchMock.calls[0].init?.method).toBe("POST");
    });

    it("sends correct body with chat_id and HTML parse mode", async () => {
      await harness.configure();

      await harness.provider.send(TEST_PAYLOAD);

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      expect(body.chat_id).toBe("-1001234");
      expect(body.parse_mode).toBe("HTML");
      expect(body.text).toContain("Charging Started");
      expect(body.text).toContain("Vehicle is now charging");
    });

    it("includes vehicle name when provided", async () => {
      await harness.configure();

      await harness.provider.send({ ...TEST_PAYLOAD, vehicleName: "My Tesla" });

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      expect(body.text).toContain("My Tesla");
    });

    it("includes topic ID when configured", async () => {
      await harness.configure({
        token: "123:ABC",
        chatId: "-1001234",
        topicId: "42",
      });

      await harness.provider.send(TEST_PAYLOAD);

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      expect(body.message_thread_id).toBe(42);
    });

    it("sends silently when configured", async () => {
      await harness.configure({
        token: "123:ABC",
        chatId: "-1001234",
        silent: true,
      });

      await harness.provider.send(TEST_PAYLOAD);

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      expect(body.disable_notification).toBe(true);
    });

    it("throws on non-OK API response", async () => {
      await harness.configure();
      harness.fetchMock.setResponse(new Response("Forbidden", { status: 403 }));

      await expect(harness.provider.send(TEST_PAYLOAD)).rejects.toThrow(
        "Telegram API error 403",
      );
    });

    it("formats energy_recovered with correct emoji and message structure", async () => {
      await harness.configure();

      const payload: NotificationPayload = {
        eventType: "energy_recovered",
        title: "Energy Source Back Online",
        message: "Inverter recovered after 15 minutes of downtime",
        timestamp: new Date("2026-01-01T12:00:00Z"),
      };

      await harness.provider.send(payload);

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      // energy_recovered uses ✅ emoji
      expect(body.text).toContain("✅");
      expect(body.text).toContain("Energy Source Back Online");
      expect(body.text).toContain("Inverter recovered after 15 minutes");
    });

    it("formats outage error with 'Energy Source Offline' title", async () => {
      await harness.configure();

      const payload: NotificationPayload = {
        eventType: "error",
        title: "Energy Source Offline",
        message: "Fronius inverter has been unreachable for 30 minutes",
        timestamp: new Date("2026-01-01T12:00:00Z"),
      };

      await harness.provider.send(payload);

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      // error uses ❌ emoji
      expect(body.text).toContain("❌");
      expect(body.text).toContain("Energy Source Offline");
      expect(body.text).toContain("unreachable for 30 minutes");
    });

    it("uses fallback emoji for unknown event type", async () => {
      await harness.configure();

      await harness.provider.send({
        ...TEST_PAYLOAD,
        eventType: "future_event" as NotificationPayload["eventType"],
      });

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      // Unknown event type falls back to 🔔
      expect(body.text).toContain("🔔");
    });

    it("escapes HTML in title and message", async () => {
      await harness.configure();

      await harness.provider.send({
        ...TEST_PAYLOAD,
        title: "Test <b>bold</b>",
        message: "Message with <script> & more",
      });

      const body = JSON.parse(harness.fetchMock.calls[0].init?.body as string);
      expect(body.text).toContain("&lt;b&gt;bold&lt;/b&gt;");
      expect(body.text).toContain("&lt;script&gt;");
      expect(body.text).toContain("&amp;");
    });
  });
});
