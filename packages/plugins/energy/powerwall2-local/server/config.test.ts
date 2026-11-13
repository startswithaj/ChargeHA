import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  DEFAULT_POWERWALL_MAX_STALENESS_SECONDS,
  parseMaxStalenessSeconds,
} from "./config.ts";

describe("parseMaxStalenessSeconds", () => {
  it("uses the safe default when config is absent", () => {
    expect(parseMaxStalenessSeconds(null)).toBe(
      DEFAULT_POWERWALL_MAX_STALENESS_SECONDS,
    );
  });

  it("accepts values in the configured safety range", () => {
    expect(parseMaxStalenessSeconds("30")).toBe(30);
    expect(parseMaxStalenessSeconds("300")).toBe(300);
  });

  it("rejects disabled or excessive freshness limits", () => {
    expect(() => parseMaxStalenessSeconds("0")).toThrow("10-300");
    expect(() => parseMaxStalenessSeconds("301")).toThrow("10-300");
    expect(() => parseMaxStalenessSeconds("not-a-number")).toThrow("10-300");
  });
});
