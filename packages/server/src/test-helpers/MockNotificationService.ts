/**
 * Used by tRPC notifications router tests. The listener-side variant is in
 * `MockListenerNotificationService.ts`.
 */
export class MockNotificationService {
  sendTestError: string | null = null;

  sendTest(): void {
    if (this.sendTestError) {
      throw new Error(this.sendTestError);
    }
  }

  getProviderTypes(): string[] {
    return ["telegram"];
  }
}
