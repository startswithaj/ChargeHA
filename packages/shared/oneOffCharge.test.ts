import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  formatDurationMinutes,
  ONE_OFF_DURATION_OPTIONS,
  oneOffDurationMinutes,
  resolveOneOffWindow,
} from "./oneOffCharge.ts";

describe("oneOffCharge", () => {
  const SYDNEY = "Australia/Sydney";
  // 2026-08-11 is a Tuesday. 04:00Z = 14:00 Sydney (AEST, UTC+10).
  const tuesdayAfternoon = () => new Date("2026-08-11T04:00:00Z");

  describe("ONE_OFF_DURATION_OPTIONS", () => {
    it("runs 30m to 8h in 30-minute steps", () => {
      expect(ONE_OFF_DURATION_OPTIONS[0]).toBe(30);
      expect(ONE_OFF_DURATION_OPTIONS.at(-1)).toBe(480);
      expect(ONE_OFF_DURATION_OPTIONS.length).toBe(16);
      expect(ONE_OFF_DURATION_OPTIONS.every((m) => m % 30 === 0)).toBe(true);
    });
  });

  describe("resolveOneOffWindow", () => {
    it("resolves to today when the start time is still ahead", () => {
      const w = resolveOneOffWindow("23:30", 180, tuesdayAfternoon(), SYDNEY);
      expect(w.oneOffDate).toBe("2026-08-11");
      expect(w.isTomorrow).toBe(false);
      expect(w.endTime).toBe("02:30");
    });

    it("resolves to tomorrow when the start time has already passed", () => {
      // 13:00Z = 23:00 Sydney, so 22:00 is behind us
      const lateEvening = new Date("2026-08-11T13:00:00Z");
      const w = resolveOneOffWindow("22:00", 120, lateEvening, SYDNEY);
      expect(w.oneOffDate).toBe("2026-08-12");
      expect(w.isTomorrow).toBe(true);
    });

    it("treats a start time equal to the current minute as tomorrow", () => {
      // Exactly 14:00 Sydney — "now" has passed, so the next 14:00 is tomorrow
      const w = resolveOneOffWindow("14:00", 60, tuesdayAfternoon(), SYDNEY);
      expect(w.oneOffDate).toBe("2026-08-12");
      expect(w.isTomorrow).toBe(true);
    });

    it("flags a window that runs past midnight and dates its end", () => {
      const w = resolveOneOffWindow("23:30", 180, tuesdayAfternoon(), SYDNEY);
      expect(w.wrapsMidnight).toBe(true);
      expect(w.endDate).toBe("2026-08-12");
    });

    it("does not flag a window that ends the same day", () => {
      const w = resolveOneOffWindow("18:00", 120, tuesdayAfternoon(), SYDNEY);
      expect(w.wrapsMidnight).toBe(false);
      expect(w.endDate).toBe("2026-08-11");
      expect(w.endTime).toBe("20:00");
    });

    it("treats a window ending exactly at midnight as wrapping", () => {
      const w = resolveOneOffWindow("23:30", 30, tuesdayAfternoon(), SYDNEY);
      expect(w.endTime).toBe("00:00");
      expect(w.wrapsMidnight).toBe(true);
      expect(w.endDate).toBe("2026-08-12");
    });

    it("rolls the date across a month boundary", () => {
      // 2026-08-31 23:00Z = 2026-09-01 09:00 Sydney, so the next 08:00 there
      // is on 2026-09-02
      const w = resolveOneOffWindow(
        "08:00",
        60,
        new Date("2026-08-31T23:00:00Z"),
        SYDNEY,
      );
      expect(w.oneOffDate).toBe("2026-09-02");
    });

    it("resolves against the configured timezone, not the host's", () => {
      // 20:00Z on the 11th is already 06:00 on the 12th in Sydney, so a 23:30
      // start belongs to the 12th there — a UTC reading would say the 11th.
      const w = resolveOneOffWindow(
        "23:30",
        180,
        new Date("2026-08-11T20:00:00Z"),
        SYDNEY,
      );
      expect(w.oneOffDate).toBe("2026-08-12");
    });

    it("falls back to host local time when no timezone is configured", () => {
      const now = new Date();
      const w = resolveOneOffWindow("23:30", 60, now, "");
      const pad = (n: number) => String(n).padStart(2, "0");
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${
        pad(now.getDate())
      }`;
      // Either tonight's 23:30 or tomorrow's, depending on the host clock
      expect(w.isTomorrow ? "next-day" : w.oneOffDate).toBe(
        w.isTomorrow ? "next-day" : today,
      );
    });
  });

  describe("oneOffDurationMinutes", () => {
    it("measures a same-day window", () => {
      expect(oneOffDurationMinutes("18:00", "20:30")).toBe(150);
    });

    it("measures a window that wraps past midnight", () => {
      expect(oneOffDurationMinutes("23:30", "02:30")).toBe(180);
    });

    it("measures a window ending exactly at midnight", () => {
      expect(oneOffDurationMinutes("23:30", "00:00")).toBe(30);
    });

    it("round-trips every selectable duration", () => {
      const roundTrips = ONE_OFF_DURATION_OPTIONS.map((minutes) => {
        const w = resolveOneOffWindow(
          "23:30",
          minutes,
          tuesdayAfternoon(),
          SYDNEY,
        );
        return oneOffDurationMinutes("23:30", w.endTime);
      });
      expect(roundTrips).toEqual(ONE_OFF_DURATION_OPTIONS);
    });
  });

  describe("formatDurationMinutes", () => {
    it("formats hours, minutes, and both", () => {
      expect(formatDurationMinutes(30)).toBe("30m");
      expect(formatDurationMinutes(180)).toBe("3h");
      expect(formatDurationMinutes(210)).toBe("3h 30m");
      expect(formatDurationMinutes(480)).toBe("8h");
    });
  });
});
