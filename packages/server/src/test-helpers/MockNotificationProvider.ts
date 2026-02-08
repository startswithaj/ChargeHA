import type {
  NotificationPayload,
  NotificationProvider,
} from "../services/notification-providers/types.ts";

export class MockNotificationProvider implements NotificationProvider {
  sentPayloads: NotificationPayload[] = [];
  shouldFail = false;
  validationError: string | null = null;

  constructor(
    readonly type = "mock",
    readonly displayName = "Mock Provider",
  ) {}

  send(payload: NotificationPayload): Promise<void> {
    if (this.shouldFail) return Promise.reject(new Error("Send failed"));
    this.sentPayloads.push(payload);
    return Promise.resolve();
  }

  validateConfig(_config: Record<string, string>): string | null {
    return this.validationError;
  }
}
