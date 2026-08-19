import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { getConfigurationRes } from "./OcppMessages.ts";
import type { z } from "zod";

type ConfigKey = NonNullable<
  z.infer<typeof getConfigurationRes>["configurationKey"]
>[number];

// IEC 61851 floors the pilot signal at 6A, so no real max sits below it.
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

  async detect(id: string): Promise<void> {
    const last = this.lastAttemptAt.get(id);
    if (last !== undefined && Date.now() - last < RETRY_AFTER_MS) return;
    this.lastAttemptAt.set(id, Date.now());
    try {
      const res = getConfigurationRes.parse(
        await this.call(id, "GetConfiguration", {}),
      );
      const keys = res.configurationKey ?? [];
      this.dbLog.debug(`GetConfiguration dump (${id})`, {
        payload: { chargePointId: id, keys: keys.map(redacted) },
      });
      const candidates = maxCurrentCandidates(keys);
      const pick = pickConfident(candidates);
      if (pick === null) this.detected.delete(id);
      else this.detected.set(id, pick.amps);
      this.dbLog.info(summary(id, pick, candidates), {
        payload: { chargePointId: id, candidates },
      });
    } catch (error) {
      this.dbLog.warn(`Max-current detection failed (${id})`, {
        payload: { chargePointId: id, error: String(error) },
      });
    }
  }
}

const redacted = (k: ConfigKey) => ({
  ...k,
  value: SENSITIVE_KEY.test(k.key) ? "[redacted]" : k.value,
});

const maxCurrentCandidates = (keys: ConfigKey[]): Candidate[] =>
  keys.flatMap((k) => {
    const amps = parseInt(k.value ?? "", 10);
    if (!(amps >= PLAUSIBLE_MIN_A && amps <= PLAUSIBLE_MAX_A)) return [];
    const lower = k.key.toLowerCase();
    const confident = KNOWN_MAX_CURRENT_KEYS.has(lower);
    if (!confident && !looksLikeMaxCurrentKey(lower)) return [];
    return [{ key: k.key, amps, readonly: k.readonly === true, confident }];
  });

const looksLikeMaxCurrentKey = (key: string): boolean =>
  (key.includes("current") || key.includes("amp")) &&
  (key.includes("max") || key.includes("limit"));

// A readonly key is a hardware limit; a settable one may only be a preference.
const pickConfident = (candidates: Candidate[]): Candidate | null => {
  const confident = candidates.filter((c) => c.confident);
  return confident.find((c) => c.readonly) ?? confident[0] ?? null;
};

const summary = (
  id: string,
  pick: Candidate | null,
  candidates: Candidate[],
): string => {
  if (pick !== null) {
    return `Detected max current ${pick.amps}A via ${pick.key} (${id})`;
  }
  if (candidates.length > 0) {
    return `Possible max-current keys, none confident (${id})`;
  }
  return `No max-current key exposed (${id})`;
};
