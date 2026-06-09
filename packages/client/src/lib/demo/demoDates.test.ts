import { describe, expect, it } from "vitest";
import {
  dateForOffset,
  offsetForDate,
  parseDateKey,
  startOfToday,
  timeToMinutes,
  toDateKey,
} from "./demoDates.ts";

describe("demoDates", () => {
  const now = new Date(2026, 5, 3, 14, 30); // 2026-06-03 14:30 local

  describe("startOfToday", () => {
    it("strips the time to local midnight", () => {
      expect(startOfToday(now).getHours()).toBe(0);
      expect(toDateKey(startOfToday(now))).toBe("2026-06-03");
    });
  });

  describe("dateForOffset", () => {
    it("offset 0 is today", () => {
      expect(dateForOffset(0, now)).toBe("2026-06-03");
    });

    it("offset 1 is yesterday", () => {
      expect(dateForOffset(1, now)).toBe("2026-06-02");
    });

    it("crosses month boundaries", () => {
      expect(dateForOffset(3, now)).toBe("2026-05-31");
    });
  });

  describe("offsetForDate", () => {
    it("today maps to 0", () => {
      expect(offsetForDate("2026-06-03", now)).toBe(0);
    });

    it("is the inverse of dateForOffset", () => {
      expect(offsetForDate(dateForOffset(42, now), now)).toBe(42);
    });
  });

  describe("parseDateKey / toDateKey round-trip", () => {
    it("preserves the date", () => {
      expect(toDateKey(parseDateKey("2026-01-09"))).toBe("2026-01-09");
    });
  });

  describe("timeToMinutes", () => {
    it("converts HH:MM to minutes since midnight", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("08:15")).toBe(495);
      expect(timeToMinutes("23:45")).toBe(1425);
    });
  });
});
