import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import type { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import type {
  HealthCheckResult,
  PluginHealthCheck,
} from "@chargeha/shared/plugins";

const DEFAULT_TIMEOUT_MS = 5000;

/** Worst first. The dashboard renders in this order, so the most serious
 *  problem sits at the top when several checks report at once. */
const SEVERITY_ORDER = ["error", "warning"] as const;

export type WarningSeverity = (typeof SEVERITY_ORDER)[number];

export interface PluginWarning {
  title: string;
  message: string;
  severity: WarningSeverity;
}

/**
 * Plugins that implement multiple roles (Tesla is both vehicle and charger) are
 * registered in more than one registry, so the same check arrives twice.
 */
function dedupeByName(checks: PluginHealthCheck[]): PluginHealthCheck[] {
  return [...new Map(checks.map((check) => [check.name, check])).values()];
}

function raceWithTimeout(
  task: Promise<HealthCheckResult>,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const { promise, resolve } = Promise.withResolvers<HealthCheckResult>();
  const timer = setTimeout(
    () =>
      resolve({
        status: "timeout",
        message: `Timed out after ${timeoutMs}ms`,
      }),
    timeoutMs,
  );
  return Promise.race([task, promise]).finally(() => clearTimeout(timer));
}

/** null when the check passed. A check that rejected or timed out reported
 *  nothing at all, so it cannot be downgraded to a warning. */
function severityOf(
  settled: PromiseSettledResult<HealthCheckResult>,
): WarningSeverity | null {
  if (settled.status === "rejected") return "error";
  if (settled.value.status === "ok") return null;
  return settled.value.status === "warning" ? "warning" : "error";
}

/** The check's own message wins so a check with several failure modes can say
 *  which one it hit; `warningMessage` covers the checks that report no detail.
 *  A timeout or a rejection is not the check reporting anything — the message
 *  there is ours, not the plugin's, so the static text stays. */
function messageOf(
  settled: PromiseSettledResult<HealthCheckResult>,
  fallback: string,
): string {
  if (settled.status === "rejected") return fallback;
  if (settled.value.status === "timeout") return fallback;
  return settled.value.message ?? fallback;
}

export interface EncryptionCheckResult {
  configured: boolean;
}

export class HealthService {
  constructor(
    private readonly vehiclePlugins: VehiclePluginRegistry,
    private readonly energyPlugins: EnergyPluginRegistry,
    private readonly chargerPlugins: ChargerPluginRegistry,
    private readonly encryptionKey: string | null,
  ) {}

  /** Check if ENCRYPTION_KEY is configured. */
  checkEncryption(): EncryptionCheckResult {
    return { configured: this.encryptionKey !== null };
  }

  /** Collect user-facing warnings from all failed plugin health checks. */
  async getPluginWarnings(): Promise<PluginWarning[]> {
    const checks = dedupeByName([
      ...this.vehiclePlugins.getHealthChecks(),
      ...this.energyPlugins.getHealthChecks(),
      ...this.chargerPlugins.getHealthChecks(),
    ]);
    if (checks.length === 0) return [];

    const results = await this.runChecks(checks);

    const warnings = checks.flatMap((check, i) => {
      const { warningTitle, warningMessage } = check;
      if (!warningTitle || !warningMessage) return [];
      const severity = severityOf(results[i]);
      if (severity === null) return [];
      return [{
        title: warningTitle,
        message: messageOf(results[i], warningMessage),
        severity,
      }];
    });

    return warnings.toSorted((a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
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
