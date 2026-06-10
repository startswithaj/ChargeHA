import { describe, expect, it, vi } from "vitest";

const { mockState } = vi.hoisted(() => ({
  mockState: { config: { timezone: "" } as { timezone?: string } },
}));

vi.mock("./demoState.ts", () => ({
  getDemoState: () => mockState,
}));

import { demoNow } from "./demoClock.ts";

describe("demoNow", () => {
  it("returns the wall-clock time in the configured timezone", () => {
    mockState.config.timezone = "America/New_York";
    // Noon UTC → 8am New York (EDT, UTC-4) in June.
    const result = demoNow(new Date("2026-06-10T12:00:00Z"));
    expect(result.getHours()).toBe(8);
  });

  it("differs per timezone for the same instant", () => {
    const instant = new Date("2026-06-10T12:00:00Z");
    mockState.config.timezone = "America/New_York";
    const ny = demoNow(instant).getHours();
    mockState.config.timezone = "Australia/Sydney";
    const sydney = demoNow(instant).getHours();
    expect(ny).not.toBe(sydney);
  });

  it("returns the base time unchanged when no timezone is set", () => {
    mockState.config.timezone = "";
    const base = new Date("2026-06-10T12:00:00Z");
    expect(demoNow(base)).toBe(base);
  });
});
