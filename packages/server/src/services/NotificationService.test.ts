import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../db/AppDatabase.ts";
import { NotificationService } from "./NotificationService.ts";
import { Logger } from "../lib/Logger.ts";
import { MockNotificationProvider } from "../test-helpers/MockNotificationProvider.ts";

describe("NotificationService", () => {
  const testLogger = new Logger("Notifications", "error");

  let db: AppDatabase;
  let provider: MockNotificationProvider;
  let service: NotificationService;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    provider = new MockNotificationProvider();
    service = new NotificationService(db, [provider], testLogger);
  });

  afterEach(() => {
    db.close();
  });

  describe("getProviderTypes", () => {
    it("returns registered provider types", () => {
      expect(service.getProviderTypes()).toEqual(["mock"]);
    });

    it("returns empty array when no providers", () => {
      const empty = new NotificationService(db, [], testLogger);
      expect(empty.getProviderTypes()).toEqual([]);
    });
  });

  describe("notify", () => {
    it("sends notification when provider and event are configured", async () => {
      await db.setConfig("notification_provider", "mock");
      await db.setConfig(
        "notification_enabled_events",
        "charge_started,charge_stopped",
      );

      await service.notify("charge_started", "Charging", "Started charging");

      expect(provider.sentPayloads).toHaveLength(1);
      expect(provider.sentPayloads[0].eventType).toBe("charge_started");
      expect(provider.sentPayloads[0].title).toBe("Charging");
      expect(provider.sentPayloads[0].message).toBe("Started charging");
    });

    it("does nothing when no provider is configured", async () => {
      await service.notify("charge_started", "Test", "Test message");
      expect(provider.sentPayloads).toHaveLength(0);
    });

    it("does nothing when event is not in enabled list", async () => {
      await db.setConfig("notification_provider", "mock");
      await db.setConfig("notification_enabled_events", "charge_stopped");

      await service.notify("charge_started", "Test", "Test message");
      expect(provider.sentPayloads).toHaveLength(0);
    });

    it("does nothing when no enabled events configured", async () => {
      await db.setConfig("notification_provider", "mock");

      await service.notify("charge_started", "Test", "Test message");
      expect(provider.sentPayloads).toHaveLength(0);
    });

    it("passes vehicle name and ID in notification", async () => {
      await db.setConfig("notification_provider", "mock");
      await db.setConfig("notification_enabled_events", "charge_started");

      await service.notify("charge_started", "Title", "Body", {
        vehicleName: "Tesla",
        vehicleId: "VIN1",
      });

      expect(provider.sentPayloads[0].vehicleName).toBe("Tesla");
      expect(provider.sentPayloads[0].vehicleId).toBe("VIN1");
    });

    it("sends every notify call through (no rate limiting)", async () => {
      await db.setConfig("notification_provider", "mock");
      await db.setConfig("notification_enabled_events", "charge_started");

      await service.notify("charge_started", "Title", "Body", {
        vehicleId: "VIN1",
      });
      await service.notify("charge_started", "Title", "Body", {
        vehicleId: "VIN1",
      });

      expect(provider.sentPayloads).toHaveLength(2);
    });

    it("does not throw when provider send fails", async () => {
      await db.setConfig("notification_provider", "mock");
      await db.setConfig("notification_enabled_events", "charge_started");
      provider.shouldFail = true;

      // Should not throw
      await service.notify("charge_started", "Title", "Body");
    });

    it("does not throw when provider type is unknown", async () => {
      await db.setConfig("notification_provider", "nonexistent");
      await db.setConfig("notification_enabled_events", "charge_started");

      await service.notify("charge_started", "Title", "Body");
      expect(provider.sentPayloads).toHaveLength(0);
    });

    it("accepts and dispatches energy_recovered event type", async () => {
      await db.setConfig("notification_provider", "mock");
      await db.setConfig("notification_enabled_events", "energy_recovered");

      await service.notify(
        "energy_recovered",
        "Energy Source Back Online",
        "Inverter recovered after 15 minutes of downtime",
      );

      expect(provider.sentPayloads).toHaveLength(1);
      expect(provider.sentPayloads[0].eventType).toBe("energy_recovered");
      expect(provider.sentPayloads[0].title).toBe("Energy Source Back Online");
      expect(provider.sentPayloads[0].message).toContain(
        "recovered after 15 minutes",
      );
    });
  });

  describe("sendTest", () => {
    it("sends test notification bypassing event checks", async () => {
      await db.setConfig("notification_provider", "mock");
      // No enabled events — sendTest should still work

      await service.sendTest();

      expect(provider.sentPayloads).toHaveLength(1);
      expect(provider.sentPayloads[0].title).toBe("Test Notification");
    });

    it("throws when no provider is configured", async () => {
      await expect(service.sendTest()).rejects.toThrow(
        "No notification provider configured",
      );
    });

    it("throws when provider type is unknown", async () => {
      await db.setConfig("notification_provider", "nonexistent");

      await expect(service.sendTest()).rejects.toThrow("Unknown provider");
    });

    it("throws when provider validation fails", async () => {
      await db.setConfig("notification_provider", "mock");
      provider.validationError = "Missing token";

      await expect(service.sendTest()).rejects.toThrow("Missing token");
    });

    it("reads and validates provider config fields from DB", async () => {
      // Use a "telegram" provider so PROVIDER_CONFIG_FIELDS has entries
      const telegramProvider = new MockNotificationProvider(
        "telegram",
        "Telegram",
      );
      const svc = new NotificationService(
        db,
        [telegramProvider],
        testLogger,
      );
      await db.setConfig("notification_provider", "telegram");
      // Set one config value so `if (val)` truthy branch is covered
      await db.setConfig("notification_telegram_bot_token", "test-token");
      // Other telegram fields left unset → `if (val)` falsy branch covered

      await svc.sendTest();
      expect(telegramProvider.sentPayloads).toHaveLength(1);
    });

    it("skips config fields with no DB key mapping", async () => {
      const { PROVIDER_CONFIG_FIELDS } = await import(
        "./notification-providers/types.ts"
      );
      // Temporarily add a field with an unmapped key
      const origFields = PROVIDER_CONFIG_FIELDS["mock_cfg"];
      PROVIDER_CONFIG_FIELDS["mock_cfg"] = [
        {
          key: "unmappedFieldKey",
          label: "Unmapped",
          help: "",
          type: "text" as const,
        },
      ];
      try {
        const cfgProvider = new MockNotificationProvider(
          "mock_cfg",
          "Mock Cfg",
        );
        const svc = new NotificationService(
          db,
          [cfgProvider],
          testLogger,
        );
        await db.setConfig("notification_provider", "mock_cfg");

        await svc.sendTest();
        expect(cfgProvider.sentPayloads).toHaveLength(1);
      } finally {
        if (origFields) {
          PROVIDER_CONFIG_FIELDS["mock_cfg"] = origFields;
        } else {
          delete PROVIDER_CONFIG_FIELDS["mock_cfg"];
        }
      }
    });
  });
});
