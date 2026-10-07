import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { roundTo } from "./round.ts";

describe("roundTo", () => {
  it("rounds to the given number of decimals", () => {
    expect(roundTo(6.642, 2)).toBe(6.64);
    expect(roundTo(9.596, 2)).toBe(9.6);
    expect(roundTo(12.34, 1)).toBe(12.3);
    expect(roundTo(7.8, 0)).toBe(8);
  });
});
