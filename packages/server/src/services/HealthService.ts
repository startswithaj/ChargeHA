import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type {
  HealthCheckResult,
  PluginHealthCheck,
} from "@chargeha/plugins/types";

const DEFAULT_TIMEOUT_MS = 5000;

function raceWithTimeout(
  task: Promise<HealthCheckResult>,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const ref = { timer: 0 };
  const timeout = new Promise<HealthCheckResult>((resolve) => {
    ref.timer = setTimeout(
      () =>
        resolve({
          status: "timeout",
          message: `Timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(ref.timer));
}

export interface EncryptionCheckResult {
  configured: boolean;
}

export class HealthService {
  constructor(
    private readonly vehiclePlugins: VehiclePluginRegistry,
    private readonly encryptionKey: string | null,
  ) {}

  /** Check if ENCRYPTION_KEY is configured. */
  checkEncryption(): EncryptionCheckResult {
    return { configured: this.encryptionKey !== null };
  }

  /** Collect user-facing warnings from all failed plugin health checks. */
  async getPluginWarnings(): Promise<
    Array<{ title: string; message: string }>
  > {
    const checks = this.vehiclePlugins.getHealthChecks();
    if (checks.length === 0) return [];

    const results = await this.runChecks(checks);

    return checks.flatMap((check, i) => {
      const result = results[i];
      if (!check.warningTitle || !check.warningMessage) return [];
      const failed = result.status === "rejected" ||
        result.value.status !== "ok";
      if (!failed) return [];
      return [{ title: check.warningTitle, message: check.warningMessage }];
    });
  }

  private runChecks(checks: PluginHealthCheck[]) {
    return Promise.allSettled(
      checks.map((check) => {
        const timeout = check.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        return raceWithTimeout(check.run(), timeout);
      }),
    );
  }
}
