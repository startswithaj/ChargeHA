import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCost,
  formatDays,
  formatRelativeTime,
  formatTime12h,
  kwhValue,
  kwValue,
} from "./Format.ts";

describe("kwValue", () => {
  it("returns watts for values below 1000", () => {
    expect(kwValue(500)).toBe("500 W");
    expect(kwValue(1)).toBe("1 W");
    expect(kwValue(999)).toBe("999 W");
  });

  it("returns kW for values at or above 1000", () => {
    expect(kwValue(1000)).toBe("1.0 kW");
    expect(kwValue(1500)).toBe("1.5 kW");
    expect(kwValue(5234)).toBe("5.2 kW");
    expect(kwValue(12345)).toBe("12.3 kW");
  });

  it("returns 0 W for zero", () => {
    expect(kwValue(0)).toBe("0 W");
  });

  it("handles negative values below 1000 threshold", () => {
    expect(kwValue(-500)).toBe("-500 W");
    expect(kwValue(-999)).toBe("-999 W");
  });

  it("handles negative values at or above 1000 threshold", () => {
    expect(kwValue(-1000)).toBe("-1.0 kW");
    expect(kwValue(-5234)).toBe("-5.2 kW");
  });

  it("rounds watts to nearest integer", () => {
    expect(kwValue(342.7)).toBe("343 W");
    expect(kwValue(342.2)).toBe("342 W");
  });

  it("formats kW to one decimal place", () => {
    expect(kwValue(1050)).toBe("1.1 kW");
    expect(kwValue(1049)).toBe("1.0 kW");
  });
});

describe("kwhValue", () => {
  it("returns Wh for values below 1000", () => {
    expect(kwhValue(500)).toBe("500 Wh");
    expect(kwhValue(1)).toBe("1 Wh");
    expect(kwhValue(999)).toBe("999 Wh");
  });

  it("returns kWh for values at or above 1000", () => {
    expect(kwhValue(1000)).toBe("1.0 kWh");
    expect(kwhValue(1500)).toBe("1.5 kWh");
    expect(kwhValue(12345)).toBe("12.3 kWh");
  });

  it("returns 0 Wh for zero", () => {
    expect(kwhValue(0)).toBe("0 Wh");
  });

  it("handles negative values below 1000 threshold", () => {
    expect(kwhValue(-500)).toBe("-500 Wh");
    expect(kwhValue(-999)).toBe("-999 Wh");
  });

  it("handles negative values at or above 1000 threshold", () => {
    expect(kwhValue(-1000)).toBe("-1.0 kWh");
    expect(kwhValue(-5234)).toBe("-5.2 kWh");
  });

  it("rounds Wh to nearest integer", () => {
    expect(kwhValue(342.7)).toBe("343 Wh");
    expect(kwhValue(342.2)).toBe("342 Wh");
  });

  it("formats kWh to one decimal place", () => {
    expect(kwhValue(1050)).toBe("1.1 kWh");
    expect(kwhValue(1049)).toBe("1.0 kWh");
  });
});

describe("formatCost", () => {
  it("formats cents to currency string", () => {
    expect(formatCost(1250, "$")).toBe("$12.50");
    expect(formatCost(830, "$")).toBe("$8.30");
  });

  it("formats zero cost", () => {
    expect(formatCost(0, "$")).toBe("$0.00");
  });

  it("formats small amounts", () => {
    expect(formatCost(5, "$")).toBe("$0.05");
    expect(formatCost(99, "$")).toBe("$0.99");
  });

  it("formats with different currency symbols", () => {
    expect(formatCost(1000, "€")).toBe("€10.00");
    expect(formatCost(1000, "£")).toBe("£10.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCost(1255, "$")).toBe("$12.55");
  });
});

describe("formatTime12h", () => {
  it("formats midnight as 12:00 AM", () => {
    expect(formatTime12h("00:00")).toBe("12:00 AM");
  });

  it("formats 00:30 as 12:30 AM", () => {
    expect(formatTime12h("00:30")).toBe("12:30 AM");
  });

  it("formats morning hours correctly", () => {
    expect(formatTime12h("09:05")).toBe("9:05 AM");
    expect(formatTime12h("11:59")).toBe("11:59 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(formatTime12h("12:00")).toBe("12:00 PM");
  });

  it("formats afternoon hours correctly", () => {
    expect(formatTime12h("13:00")).toBe("1:00 PM");
    expect(formatTime12h("23:45")).toBe("11:45 PM");
  });
});

describe("formatDays", () => {
  it('returns "Every Day" for all 7 days', () => {
    expect(formatDays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe(
      "Every Day",
    );
  });

  it('returns "Weekdays" for mon-fri', () => {
    expect(formatDays(["mon", "tue", "wed", "thu", "fri"])).toBe("Weekdays");
  });

  it('returns "Weekends" for sat-sun', () => {
    expect(formatDays(["sat", "sun"])).toBe("Weekends");
  });

  it("returns individual day labels for partial selections", () => {
    expect(formatDays(["mon", "wed"])).toBe("Mon, Wed");
    expect(formatDays(["fri"])).toBe("Fri");
  });

  it("sorts days in week order regardless of input order", () => {
    expect(formatDays(["fri", "mon", "wed"])).toBe("Mon, Wed, Fri");
  });

  it("returns empty string for no days", () => {
    expect(formatDays([])).toBe("");
  });
});

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns seconds ago for recent times", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));

    expect(formatRelativeTime(new Date("2026-03-01T12:00:00Z"))).toBe("0s ago");
    expect(formatRelativeTime(new Date("2026-03-01T11:59:57Z"))).toBe("3s ago");
    expect(formatRelativeTime(new Date("2026-03-01T11:59:56Z"))).toBe("4s ago");
    expect(formatRelativeTime(new Date("2026-03-01T11:59:55Z"))).toBe("5s ago");
    expect(formatRelativeTime(new Date("2026-03-01T11:59:30Z"))).toBe(
      "30s ago",
    );
    expect(formatRelativeTime(new Date("2026-03-01T11:59:01Z"))).toBe(
      "59s ago",
    );
  });

  it("returns minutes ago for times between 1 and 59 minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));

    expect(formatRelativeTime(new Date("2026-03-01T11:59:00Z"))).toBe("1m ago");
    expect(formatRelativeTime(new Date("2026-03-01T11:30:00Z"))).toBe(
      "30m ago",
    );
    expect(formatRelativeTime(new Date("2026-03-01T11:01:00Z"))).toBe(
      "59m ago",
    );
  });

  it("returns hours ago for times 60 minutes or more ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));

    expect(formatRelativeTime(new Date("2026-03-01T11:00:00Z"))).toBe("1h ago");
    expect(formatRelativeTime(new Date("2026-03-01T06:00:00Z"))).toBe("6h ago");
    expect(formatRelativeTime(new Date("2026-02-28T12:00:00Z"))).toBe(
      "24h ago",
    );
  });
});
