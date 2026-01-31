import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { NotificationService } from "../../services/NotificationService.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";
import { MockNotificationService } from "../../test-helpers/MockNotificationService.ts";

describe("Notifications tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  let mockService: MockNotificationService;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(() => {
    mockService = new MockNotificationService();
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      notificationService: mockService as unknown as NotificationService,
    }));
  });

  describe("notification.providers", () => {
    it("returns provider config fields", async () => {
      const data = await caller.notification.providers();
      expect(data.telegram).toBeDefined();
      expect(Array.isArray(data.telegram)).toBe(true);
      expect(data.telegram[0].key).toBe("notificationTelegramBotToken");
    });
  });

  describe("notification.test", () => {
    it("returns success when test notification sends", async () => {
      const data = await caller.notification.test();
      expect(data.success).toBe(true);
    });

    it("returns error message on failure", async () => {
      mockService.sendTestError = "No provider configured";

      const data = await caller.notification.test();
      expect(data).toEqual({
        success: false,
        error: "No provider configured",
      });
    });
  });
});
