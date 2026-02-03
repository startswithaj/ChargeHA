import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { RateLimiter } from "./rateLimit.ts";
import { FakeTime } from "@std/testing/time";

describe("RateLimiter", () => {
  let limiter: RateLimiter;
  let fakeTime: FakeTime;

  beforeEach(() => {
    fakeTime = new FakeTime();
    limiter = new RateLimiter();
  });

  afterEach(() => {
    fakeTime.restore();
  });

  const triggerLockout = (ip = "1.2.3.4") =>
    Array.from({ length: 5 }).forEach(() => limiter.recordFailure(ip));

  describe("check()", () => {
    it("allows requests with no prior failures", () => {
      const result = limiter.check("1.2.3.4");
      expect(result).toEqual({ allowed: true });
    });

    it("allows requests below the failure threshold", () => {
      Array.from({ length: 4 }).forEach(() => {
        limiter.recordFailure("1.2.3.4");
      });
      const result = limiter.check("1.2.3.4");
      expect(result).toEqual({ allowed: true });
    });
  });

  describe("lockout trigger", () => {
    it("locks out after 5 failed attempts", () => {
      triggerLockout();
      const result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(60); // 1 minute
    });

    it("does not lock out other IPs", () => {
      triggerLockout();
      const result = limiter.check("5.6.7.8");
      expect(result).toEqual({ allowed: true });
    });
  });

  describe("lockout escalation", () => {
    it("escalates lockout: 1 min -> 2 min -> 4 min", () => {
      // First lockout: 5 failures → 1 min
      triggerLockout();
      let result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(60);

      // Wait for lockout to expire
      fakeTime.tick(61_000);
      result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(true);

      // Another failure after unlock → 2 min lockout
      limiter.recordFailure("1.2.3.4");
      result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(120);

      // Wait for lockout to expire
      fakeTime.tick(121_000);
      result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(true);

      // Another failure → 4 min lockout
      limiter.recordFailure("1.2.3.4");
      result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(240);
    });

    it("caps lockout at 15 minutes", () => {
      // Trigger initial lockout (5 failures → 1 min)
      triggerLockout();

      // Escalate: 1 → 2 → 4 → 8 → 15 (capped)
      const expectedMinutes = [1, 2, 4, 8, 15, 15];
      expectedMinutes.forEach((expectedMin) => {
        const result = limiter.check("1.2.3.4");
        expect(result.allowed).toBe(false);
        expect(result.retryAfter).toBe(expectedMin * 60);

        // Wait for lockout to expire, then trigger another failure
        fakeTime.tick(expectedMin * 60_000 + 1000);
        limiter.recordFailure("1.2.3.4");
      });
    });
  });

  describe("reset on success", () => {
    it("resets counter on successful login", () => {
      triggerLockout();
      expect(limiter.check("1.2.3.4").allowed).toBe(false);

      limiter.recordSuccess("1.2.3.4");
      expect(limiter.check("1.2.3.4")).toEqual({ allowed: true });

      // Should need 5 fresh failures to lock out again
      Array.from({ length: 4 }).forEach(() => {
        limiter.recordFailure("1.2.3.4");
      });
      expect(limiter.check("1.2.3.4").allowed).toBe(true);
    });

    it("does not affect other IPs on success reset", () => {
      Array.from({ length: 5 }).forEach(() => {
        limiter.recordFailure("1.2.3.4");
        limiter.recordFailure("5.6.7.8");
      });
      limiter.recordSuccess("1.2.3.4");

      expect(limiter.check("1.2.3.4")).toEqual({ allowed: true });
      expect(limiter.check("5.6.7.8").allowed).toBe(false);
    });
  });

  describe("extractIp()", () => {
    it("reads first value from X-Forwarded-For", () => {
      const headers = new Headers({
        "x-forwarded-for": "10.0.0.1, 172.16.0.1, 192.168.0.1",
      });
      expect(limiter.extractIp(headers)).toBe("10.0.0.1");
    });

    it("reads single value from X-Forwarded-For", () => {
      const headers = new Headers({ "x-forwarded-for": "10.0.0.1" });
      expect(limiter.extractIp(headers)).toBe("10.0.0.1");
    });

    it("trims whitespace from X-Forwarded-For values", () => {
      const headers = new Headers({
        "x-forwarded-for": "  10.0.0.1  , 172.16.0.1",
      });
      expect(limiter.extractIp(headers)).toBe("10.0.0.1");
    });

    it("falls back to remote address when no X-Forwarded-For", () => {
      const headers = new Headers();
      expect(limiter.extractIp(headers, "192.168.1.100")).toBe("192.168.1.100");
    });

    it("falls back to remote address when X-Forwarded-For is empty", () => {
      const headers = new Headers({ "x-forwarded-for": "" });
      expect(limiter.extractIp(headers, "192.168.1.100")).toBe("192.168.1.100");
    });

    it("returns 'unknown' when no IP source available", () => {
      const headers = new Headers();
      expect(limiter.extractIp(headers)).toBe("unknown");
    });
  });

  describe("retryAfter countdown", () => {
    it("retryAfter decreases as time passes", () => {
      triggerLockout();

      let result = limiter.check("1.2.3.4");
      expect(result.retryAfter).toBe(60);

      fakeTime.tick(30_000); // 30 seconds pass
      result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(30);
    });

    it("allows request once lockout expires", () => {
      triggerLockout();

      fakeTime.tick(60_001); // Just past 1 minute
      const result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(true);
    });
  });
});
