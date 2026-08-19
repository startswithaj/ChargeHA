import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { getConfigurationRes } from "./OcppMessages.ts";

const PLAUSIBLE_MIN_A = 6;
const PLAUSIBLE_MAX_A = 400;
const RETRY_AFTER_MS = 10 * 60_000;

// Only an exact, known vendor key is trusted enough to drive a user-facing
// warning; substring matches are recon, logged for future additions here.
const KNOWN_MAX_CURRENT_KEYS = new Set([
  "maxchargingcurrent",
  "maximumcurrent",
  "maxcurrent",
  "chargingcurrentlimit",
]);

// Chargers are supposed to blank AuthorizationKey in GetConfiguration.conf;
// many do not, and vendor keys carry Wi-Fi PSKs and backend tokens.
const SENSITIVE_KEY = /key|secret|password|token|pass|pin|psk/i;

function looksLikeMaxCurrentKey(key: string): boolean {
  const current = key.includes("current") || key.includes("amp");
  const cap = key.includes("max") || key.includes("limit");
  return current && cap;
}

interface Candidate {
  key: string;
  amps: number;
  readonly: boolean;
  confident: boolean;
}

export class OcppMaxAmpsDetector {
  private readonly detected = new Map<string, number>();
  private readonly lastAttemptAt = new Map<string, number>();

  constructor(
    private readonly call: (
      chargePointId: string,
      action: string,
      payload: unknown,
    ) => Promise<unknown>,
    private readonly dbLog: PluginDbLogger,
  ) {}

  detectedMaxAmps(chargePointId: string): number | null {
    return this.detected.get(chargePointId) ?? null;
  }

  async detect(chargePointId: string): Promise<void> {
    const last = this.lastAttemptAt.get(chargePointId);
    if (last !== undefined && Date.now() - last < RETRY_AFTER_MS) return;
    this.lastAttemptAt.set(chargePointId, Date.now());
    try {
      const res = getConfigurationRes.parse(
        await this.call(chargePointId, "GetConfiguration", {}),
      );
      const keys = res.configurationKey ?? [];
      this.dbLog.debug(`GetConfiguration dump (${chargePointId})`, {
        payload: {
          chargePointId,
          keys: keys.map((k) => ({
            ...k,
            value: SENSITIVE_KEY.test(k.key) ? "[redacted]" : k.value,
          })),
        },
      });
      const candidates = keys.flatMap((k): Candidate[] => {
        const amps = parseInt(k.value ?? "", 10);
        if (!(amps >= PLAUSIBLE_MIN_A && amps <= PLAUSIBLE_MAX_A)) return [];
        const lower = k.key.toLowerCase();
        const confident = KNOWN_MAX_CURRENT_KEYS.has(lower);
        if (!confident && !looksLikeMaxCurrentKey(lower)) return [];
        return [{ key: k.key, amps, readonly: k.readonly === true, confident }];
      });
      const confident = candidates.filter((c) => c.confident);
      // A readonly key is a hardware limit; a settable one may be a
      // preference the user can change, so it only wins by default.
      const pick = confident.find((c) => c.readonly) ?? confident[0] ?? null;
      if (pick !== null) {
        this.detected.set(chargePointId, pick.amps);
        this.dbLog.info(
          `Detected max current ${pick.amps}A via ${pick.key} (${chargePointId})`,
          { payload: { chargePointId, candidates } },
        );
        return;
      }
      this.detected.delete(chargePointId);
      if (candidates.length > 0) {
        this.dbLog.info(
          `Possible max-current keys, none confident (${chargePointId})`,
          { payload: { chargePointId, candidates } },
        );
        return;
      }
      this.dbLog.info(`No max-current key exposed (${chargePointId})`, {
        payload: { chargePointId, keyCount: keys.length },
      });
    } catch (error) {
      this.dbLog.warn(`Max-current detection failed (${chargePointId})`, {
        payload: { chargePointId, error: String(error) },
      });
    }
  }
}
