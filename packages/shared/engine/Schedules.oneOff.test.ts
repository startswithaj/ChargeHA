import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { isOneOffExpired, isScheduleActiveNow } from "./Schedules.ts";
import type { EngineSchedule } from "./types.ts";

describe("one-off charge windows", () => {
  const SYDNEY = "Australia/Sydney";

  /** A one-off charge on Tuesday 2026-08-11, 23:30 for 3h (ends 02:30 Wed). */
  const makeOneOff = (
    overrides: Partial<EngineSchedule> = {},
  ): EngineSchedule => ({
    id: "one-off-1",
    vehicleId: "v1",
    scheduleType: "charge",
    startTime: "23:30",
    endTime: "02:30",
    // Only the start date's weekday — deliberately wrong for the wrap day,
    // which is why one-offs must not consult days at all.
    days: ["tue"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    oneOffDate: "2026-08-11",
    enabled: true,
    ...overrides,
  });

  /** An instant from a Sydney wall-clock reading (AEST, UTC+10 in August). */
  const sydney = (date: string, time: string) =>
    new Date(`${date}T${time}:00+10:00`);

  describe("isScheduleActiveNow", () => {
    describe("window that wraps past midnight", () => {
      it("is inactive before the start time on its date", () => {
        expect(
          isScheduleActiveNow(
            makeOneOff(),
            sydney("2026-08-11", "23:29"),
            SYDNEY,
          ),
        ).toBe(false);
      });

      it("is active from the start time on its date", () => {
        const s = makeOneOff();
        expect(isScheduleActiveNow(s, sydney("2026-08-11", "23:30"), SYDNEY))
          .toBe(true);
        expect(isScheduleActiveNow(s, sydney("2026-08-11", "23:59"), SYDNEY))
          .toBe(true);
      });

      it("stays active after midnight, when the weekday no longer matches", () => {
        // Wednesday 00:00 and 01:00 — days is ["tue"], so a day-of-week check
        // would wrongly report inactive here
        const s = makeOneOff();
        expect(isScheduleActiveNow(s, sydney("2026-08-12", "00:00"), SYDNEY))
          .toBe(true);
        expect(isScheduleActiveNow(s, sydney("2026-08-12", "01:00"), SYDNEY))
          .toBe(true);
      });

      it("is inactive from the end time on the following date", () => {
        const s = makeOneOff();
        expect(isScheduleActiveNow(s, sydney("2026-08-12", "02:30"), SYDNEY))
          .toBe(false);
        expect(isScheduleActiveNow(s, sydney("2026-08-12", "03:00"), SYDNEY))
          .toBe(false);
      });

      it("does not recur the following week", () => {
        expect(
          isScheduleActiveNow(
            makeOneOff(),
            sydney("2026-08-18", "23:45"),
            SYDNEY,
          ),
        ).toBe(false);
      });

      it("is inactive on the day before its date", () => {
        expect(
          isScheduleActiveNow(
            makeOneOff(),
            sydney("2026-08-10", "23:45"),
            SYDNEY,
          ),
        ).toBe(false);
      });

      it("is inactive two days later in the same clock window", () => {
        expect(
          isScheduleActiveNow(
            makeOneOff(),
            sydney("2026-08-13", "01:00"),
            SYDNEY,
          ),
        ).toBe(false);
      });
    });

    describe("window inside a single day", () => {
      const sameDay = () =>
        makeOneOff({ startTime: "13:00", endTime: "16:00", days: ["tue"] });

      it("is active inside the window", () => {
        expect(
          isScheduleActiveNow(sameDay(), sydney("2026-08-11", "14:00"), SYDNEY),
        ).toBe(true);
      });

      it("is inactive before the start and at the end", () => {
        expect(
          isScheduleActiveNow(sameDay(), sydney("2026-08-11", "12:59"), SYDNEY),
        ).toBe(false);
        expect(
          isScheduleActiveNow(sameDay(), sydney("2026-08-11", "16:00"), SYDNEY),
        ).toBe(false);
      });

      it("is inactive on the next date at the same clock time", () => {
        expect(
          isScheduleActiveNow(sameDay(), sydney("2026-08-12", "14:00"), SYDNEY),
        ).toBe(false);
      });
    });

    it("resolves the date in the configured timezone", () => {
      // 2026-08-11T14:00Z is 2026-08-12 00:00 in Sydney — inside the window
      // there, but a UTC reading would call it the 11th at 14:00 and say no.
      expect(
        isScheduleActiveNow(
          makeOneOff(),
          new Date("2026-08-11T14:00:00Z"),
          SYDNEY,
        ),
      ).toBe(true);
    });

    it("leaves recurring schedules on the day-of-week path", () => {
      const recurring = makeOneOff({ oneOffDate: null, days: ["tue"] });
      // Tuesday 23:45 matches; the following Tuesday matches too
      expect(
        isScheduleActiveNow(recurring, sydney("2026-08-11", "23:45"), SYDNEY),
      ).toBe(true);
      expect(
        isScheduleActiveNow(recurring, sydney("2026-08-18", "23:45"), SYDNEY),
      ).toBe(true);
    });
  });

  describe("isOneOffExpired", () => {
    it("is false before the window opens", () => {
      expect(
        isOneOffExpired(makeOneOff(), sydney("2026-08-11", "20:00"), SYDNEY),
      ).toBe(false);
    });

    it("is false while the window is running", () => {
      expect(
        isOneOffExpired(makeOneOff(), sydney("2026-08-12", "01:00"), SYDNEY),
      ).toBe(false);
    });

    it("is true from the end time onward", () => {
      expect(
        isOneOffExpired(makeOneOff(), sydney("2026-08-12", "02:30"), SYDNEY),
      ).toBe(true);
    });

    it("is true on later dates", () => {
      expect(
        isOneOffExpired(makeOneOff(), sydney("2026-08-20", "09:00"), SYDNEY),
      ).toBe(true);
    });

    it("handles a same-day window", () => {
      const s = makeOneOff({ startTime: "13:00", endTime: "16:00" });
      expect(isOneOffExpired(s, sydney("2026-08-11", "15:59"), SYDNEY))
        .toBe(false);
      expect(isOneOffExpired(s, sydney("2026-08-11", "16:00"), SYDNEY))
        .toBe(true);
    });

    it("never expires a recurring schedule", () => {
      const recurring = makeOneOff({ oneOffDate: null });
      expect(isOneOffExpired(recurring, sydney("2030-01-01", "12:00"), SYDNEY))
        .toBe(false);
    });
  });
});
