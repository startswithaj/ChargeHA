import { describe, expect, it } from "vitest";
import { getPresetRange } from "./logsTime.ts";

describe("getPresetRange uses the site timezone", () => {
  const now = new Date("2026-01-15T22:00:00Z");

  it("starts 'today' at site midnight, not browser midnight", () => {
    const range = getPresetRange("today", now, "Australia/Brisbane");
    expect(range.from).toBe("2026-01-15T14:00:00.000Z");
  });

  it("bounds 'yesterday' to the site's previous day", () => {
    const range = getPresetRange("yesterday", now, "Australia/Brisbane");
    expect(range.from).toBe("2026-01-14T14:00:00.000Z");
    expect(range.to).toBe("2026-01-15T13:59:59.999Z");
  });
});
