/**
 * In-memory rate limiter with escalating lockout for login brute-force protection.
 *
 * After 5 failed attempts for an IP, locks out for 1 minute.
 * Each subsequent failed attempt after unlock doubles the lockout
 * (2 min, 4 min, capped at 15 min).
 * Counter resets on successful login or when RateLimiter is re-instantiated.
 */

const MAX_ATTEMPTS = 5;
const INITIAL_LOCKOUT_MS = 60_000; // 1 minute
const MAX_LOCKOUT_MS = 15 * 60_000; // 15 minutes

interface AttemptRecord {
  failures: number;
  lockedUntil: number; // epoch ms, 0 = not locked
  lockoutMs: number; // current lockout duration (doubles each time)
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // seconds until lockout expires
}

export class RateLimiter {
  private records = new Map<string, AttemptRecord>();

  /**
   * Extract client IP from a request.
   * Reads X-Forwarded-For first value when present, falls back to remote address.
   */
  extractIp(
    headers: { get(name: string): string | null },
    remoteAddr?: string,
  ): string {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0].trim();
      if (first) return first;
    }
    return remoteAddr ?? "unknown";
  }

  /**
   * Check whether a request from this IP is allowed.
   * Returns { allowed: true } if OK, or { allowed: false, retryAfter } if locked out.
   */
  check(ip: string): RateLimitResult {
    const record = this.records.get(ip);
    if (!record) return { allowed: true };

    if (record.lockedUntil > 0) {
      const now = Date.now();
      if (now < record.lockedUntil) {
        const retryAfter = Math.ceil((record.lockedUntil - now) / 1000);
        return { allowed: false, retryAfter };
      }
      // Lockout expired — allow the attempt (but don't reset failures yet)
    }

    return { allowed: true };
  }

  /**
   * Record a failed login attempt for this IP.
   * After MAX_ATTEMPTS failures, triggers lockout with escalating duration.
   */
  recordFailure(ip: string): void {
    const existing = this.records.get(ip);
    const record = existing ?? { failures: 0, lockedUntil: 0, lockoutMs: 0 };
    if (!existing) this.records.set(ip, record);

    record.failures++;

    if (record.failures >= MAX_ATTEMPTS) {
      // Escalate lockout: first time = INITIAL, then double, capped at MAX
      const nextLockout = record.lockoutMs === 0
        ? INITIAL_LOCKOUT_MS
        : Math.min(record.lockoutMs * 2, MAX_LOCKOUT_MS);

      record.lockoutMs = nextLockout;
      record.lockedUntil = Date.now() + nextLockout;
    }
  }

  /**
   * Record a successful login — resets the counter for this IP.
   */
  recordSuccess(ip: string): void {
    this.records.delete(ip);
  }
}
