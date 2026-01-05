import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { toSqliteDatetime } from "./sqliteHelpers.ts";

describe("toSqliteDatetime", () => {
  it("converts ISO UTC string to SQLite datetime format", () => {
    expect(toSqliteDatetime("2026-04-07T15:37:00.000Z"))
      .toBe("2026-04-07 15:37:00");
  });

  it("strips sub-second precision", () => {
    expect(toSqliteDatetime("2026-04-07T15:37:00.123456Z"))
      .toBe("2026-04-07 15:37:00");
  });

  it("converts offset-bearing ISO strings to UTC", () => {
    expect(toSqliteDatetime("2026-04-08T01:37:00+10:00"))
      .toBe("2026-04-07 15:37:00");
  });

  it("throws on unparseable input", () => {
    expect(() => toSqliteDatetime("not a date")).toThrow(/Invalid datetime/);
  });
});
