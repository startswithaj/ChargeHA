import { describe, expect, it } from "vitest";
import {
  ALL_DAYS,
  detectGaps,
  detectOverlaps,
  EMPTY_FORM,
  findGapsForDay,
  formatDays,
  formatGapMessage,
  formatOverlapMessage,
  gapToFormData,
  type GapWarning,
  minutesToTime,
  timeRangesOverlap,
  timeToMinutes,
  WEEKDAYS,
  WEEKEND,
} from "./tariffUtils.ts";

describe("formatDays", () => {
  it("returns 'Every day' when all 7 days are present", () => {
    expect(formatDays([...ALL_DAYS])).toBe("Every day");
  });

  it("returns 'Weekdays' for mon-fri", () => {
    expect(formatDays([...WEEKDAYS])).toBe("Weekdays");
  });

  it("returns 'Weekends' for sat+sun", () => {
    expect(formatDays([...WEEKEND])).toBe("Weekends");
  });

  it("returns comma-separated labels for arbitrary days", () => {
    expect(formatDays(["mon", "wed", "fri"])).toBe("Mon, Wed, Fri");
  });

  it("sorts days in canonical order regardless of input order", () => {
    expect(formatDays(["fri", "mon"])).toBe("Mon, Fri");
  });

  it("returns single day label", () => {
    expect(formatDays(["thu"])).toBe("Thu");
  });
});

describe("timeToMinutes / minutesToTime", () => {
  it.each<[number, string]>([
    [0, "00:00"],
    [750, "12:30"],
    [1440, "24:00"],
    [65, "01:05"],
  ])("round-trips %i <-> %s", (mins, time) => {
    expect(minutesToTime(mins)).toBe(time);
    expect(timeToMinutes(time)).toBe(mins);
  });

  it("converts 23:59 to 1439", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

describe("timeRangesOverlap", () => {
  it.each<[string, number, number, number, number, boolean]>([
    ["simple overlap", 60, 180, 120, 240, true],
    ["non-overlapping ranges", 60, 120, 180, 240, false],
    ["adjacent ranges (no overlap)", 60, 120, 120, 180, false],
    ["overnight A overlapping daytime B", 1320, 360, 300, 480, true],
    ["two overnight ranges overlapping", 1320, 360, 1380, 300, true],
    ["non-overlapping overnight range", 1320, 120, 360, 600, false],
  ])("%s", (_label, a1, a2, b1, b2, expected) => {
    expect(timeRangesOverlap(a1, a2, b1, b2)).toBe(expected);
  });
});

describe("detectOverlaps", () => {
  it("returns empty for no periods", () => {
    expect(detectOverlaps([])).toEqual([]);
  });

  it("returns empty for non-overlapping periods", () => {
    const periods = [
      {
        label: "Peak",
        startTime: "06:00",
        endTime: "12:00",
        days: [...ALL_DAYS],
      },
      {
        label: "Off-Peak",
        startTime: "12:00",
        endTime: "18:00",
        days: [...ALL_DAYS],
      },
    ];
    expect(detectOverlaps(periods)).toEqual([]);
  });

  it("detects overlap between two periods on shared days", () => {
    const periods = [
      {
        label: "Peak",
        startTime: "06:00",
        endTime: "14:00",
        days: [...ALL_DAYS],
      },
      {
        label: "Shoulder",
        startTime: "12:00",
        endTime: "18:00",
        days: [...ALL_DAYS],
      },
    ];
    const result = detectOverlaps(periods);
    expect(result).toHaveLength(1);
    expect(result[0].periodA).toBe("Peak");
    expect(result[0].periodB).toBe("Shoulder");
  });

  it("does not report overlap when periods are on different days", () => {
    const periods = [
      {
        label: "Weekday",
        startTime: "06:00",
        endTime: "14:00",
        days: [...WEEKDAYS],
      },
      {
        label: "Weekend",
        startTime: "06:00",
        endTime: "14:00",
        days: [...WEEKEND],
      },
    ];
    expect(detectOverlaps(periods)).toEqual([]);
  });

  it("uses '(unnamed)' for periods without labels", () => {
    const periods = [
      { label: "", startTime: "06:00", endTime: "14:00", days: ["mon"] },
      { label: "", startTime: "10:00", endTime: "18:00", days: ["mon"] },
    ];
    const result = detectOverlaps(periods);
    expect(result[0].periodA).toBe("(unnamed)");
    expect(result[0].periodB).toBe("(unnamed)");
  });
});

describe("formatOverlapMessage", () => {
  it("formats overlap with day string", () => {
    const msg = formatOverlapMessage({
      periodA: "Peak",
      periodB: "Shoulder",
      days: [...ALL_DAYS],
    });
    expect(msg).toBe("Peak and Shoulder overlap on Every day");
  });
});

describe("findGapsForDay", () => {
  it("returns full day gap when no periods cover the day", () => {
    const gaps = findGapsForDay(
      [{ startTime: "06:00", endTime: "18:00", days: ["mon"] }],
      "tue",
    );
    expect(gaps).toEqual([[0, 1440]]);
  });

  it("returns no gaps when a period covers 00:00-24:00", () => {
    const gaps = findGapsForDay(
      [{ startTime: "00:00", endTime: "24:00", days: ["mon"] }],
      "mon",
    );
    expect(gaps).toEqual([]);
  });

  it("finds gap before first period", () => {
    const gaps = findGapsForDay(
      [{ startTime: "06:00", endTime: "24:00", days: ["mon"] }],
      "mon",
    );
    expect(gaps).toEqual([[0, 360]]);
  });

  it("finds gap after last period", () => {
    const gaps = findGapsForDay(
      [{ startTime: "00:00", endTime: "18:00", days: ["mon"] }],
      "mon",
    );
    expect(gaps).toEqual([[1080, 1440]]);
  });

  it("finds gap between two periods", () => {
    const gaps = findGapsForDay(
      [
        { startTime: "00:00", endTime: "06:00", days: ["mon"] },
        { startTime: "12:00", endTime: "24:00", days: ["mon"] },
      ],
      "mon",
    );
    expect(gaps).toEqual([[360, 720]]);
  });

  it("handles overnight period correctly", () => {
    // 22:00-06:00 covers [22:00,24:00) + [00:00,06:00)
    const gaps = findGapsForDay(
      [{ startTime: "22:00", endTime: "06:00", days: ["mon"] }],
      "mon",
    );
    // Gap should be 06:00-22:00
    expect(gaps).toEqual([[360, 1320]]);
  });

  it("merges overlapping ranges on the same day", () => {
    const gaps = findGapsForDay(
      [
        { startTime: "00:00", endTime: "10:00", days: ["mon"] },
        { startTime: "08:00", endTime: "18:00", days: ["mon"] },
      ],
      "mon",
    );
    // Merged: 00:00-18:00, gap: 18:00-24:00
    expect(gaps).toEqual([[1080, 1440]]);
  });

  it("returns full day gap when periods array is empty", () => {
    expect(findGapsForDay([], "mon")).toEqual([[0, 1440]]);
  });
});

describe("detectGaps", () => {
  it("returns empty when periods cover all days fully", () => {
    const periods = [
      { startTime: "00:00", endTime: "24:00", days: [...ALL_DAYS] },
    ];
    expect(detectGaps(periods)).toEqual([]);
  });

  it("groups same gap pattern across multiple days", () => {
    const periods = [
      { startTime: "06:00", endTime: "18:00", days: [...ALL_DAYS] },
    ];
    const gaps = detectGaps(periods);
    // All 7 days have the same 2 gaps: 00:00-06:00 and 18:00-24:00
    expect(gaps).toHaveLength(2);
    expect(gaps[0].days).toEqual([...ALL_DAYS]);
    expect(gaps[1].days).toEqual([...ALL_DAYS]);
  });

  it("returns gaps for days not covered by any period", () => {
    const periods = [
      { startTime: "00:00", endTime: "24:00", days: [...WEEKDAYS] },
    ];
    const gaps = detectGaps(periods);
    // Weekend has full-day gaps
    expect(gaps).toHaveLength(1);
    expect(gaps[0].days).toEqual([...WEEKEND]);
    expect(gaps[0].startTime).toBe("00:00");
    expect(gaps[0].endTime).toBe("24:00");
  });
});

describe("formatGapMessage", () => {
  it("formats gap with day string and time range", () => {
    const msg = formatGapMessage({
      days: ["mon", "tue"],
      startTime: "06:00",
      endTime: "12:00",
    });
    expect(msg).toBe(
      "No tariff rate defined for Mon, Tue 06:00\u201312:00 (default rate will apply)",
    );
  });
});

describe("gapToFormData", () => {
  it("returns EMPTY_FORM when there are no gaps", () => {
    const result = gapToFormData([]);
    expect(result).toEqual({ ...EMPTY_FORM });
  });

  it("pre-fills from a single gap", () => {
    const gaps: GapWarning[] = [
      { days: [...ALL_DAYS], startTime: "22:00", endTime: "07:00" },
    ];
    const result = gapToFormData(gaps);
    expect(result.startTime).toBe("22:00");
    expect(result.endTime).toBe("07:00");
    expect(result.days).toEqual([...ALL_DAYS]);
    expect(result.label).toBe("");
    expect(result.ratePerKwh).toBe("");
  });

  it("merges overnight gaps (one ending 24:00 + one starting 00:00 on same days)", () => {
    const gaps: GapWarning[] = [
      { days: [...ALL_DAYS], startTime: "22:00", endTime: "24:00" },
      { days: [...ALL_DAYS], startTime: "00:00", endTime: "07:00" },
    ];
    const result = gapToFormData(gaps);
    expect(result.startTime).toBe("22:00");
    expect(result.endTime).toBe("07:00");
    expect(result.days).toEqual([...ALL_DAYS]);
  });

  it("converts 24:00 endTime to 00:00 when no matching 00:00 gap exists", () => {
    const gaps: GapWarning[] = [
      { days: ["mon", "tue"], startTime: "20:00", endTime: "24:00" },
    ];
    const result = gapToFormData(gaps);
    expect(result.startTime).toBe("20:00");
    expect(result.endTime).toBe("00:00");
    expect(result.days).toEqual(["mon", "tue"]);
  });

  it("does not merge overnight gaps when days differ", () => {
    const gaps: GapWarning[] = [
      { days: ["mon", "tue"], startTime: "22:00", endTime: "24:00" },
      { days: ["wed", "thu"], startTime: "00:00", endTime: "07:00" },
    ];
    const result = gapToFormData(gaps);
    // Should pick the 24:00 gap (endsAtMidnight) and convert to 00:00
    expect(result.startTime).toBe("22:00");
    expect(result.endTime).toBe("00:00");
    expect(result.days).toEqual(["mon", "tue"]);
  });

  it("pre-fills from first gap when multiple non-overnight gaps exist", () => {
    const gaps: GapWarning[] = [
      { days: [...ALL_DAYS], startTime: "12:00", endTime: "14:00" },
      { days: [...ALL_DAYS], startTime: "18:00", endTime: "20:00" },
    ];
    const result = gapToFormData(gaps);
    expect(result.startTime).toBe("12:00");
    expect(result.endTime).toBe("14:00");
  });
});
