/**
 * Used by NotificationListener tests. Records notify() calls; distinct from
 * MockNotificationService (router-side) which exposes sendTest/getProviderTypes.
 */
export class MockListenerNotificationService {
  notifications: Array<{
    eventType: string;
    title: string;
    message: string;
    opts?: { vehicleName?: string; vehicleId?: string };
  }> = [];

  notify(
    eventType: string,
    title: string,
    message: string,
    opts?: { vehicleName?: string; vehicleId?: string },
  ): void {
    this.notifications.push({ eventType, title, message, opts });
  }
}
