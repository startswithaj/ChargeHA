import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { parsePluginLogSearch } from "./LogRepository.ts";

describe("parsePluginLogSearch", () => {
  it("returns empty include and no excludes for empty input", () => {
    expect(parsePluginLogSearch("")).toEqual({ include: "", excludes: [] });
    expect(parsePluginLogSearch("   ")).toEqual({ include: "", excludes: [] });
  });

  it("treats unprefixed input as the include phrase", () => {
    expect(parsePluginLogSearch("vehicle came online")).toEqual({
      include: "vehicle came online",
      excludes: [],
    });
  });

  it("extracts a single `-term` as an exclude", () => {
    expect(parsePluginLogSearch("-online-check")).toEqual({
      include: "",
      excludes: ["online-check"],
    });
  });

  it("combines includes and excludes", () => {
    expect(parsePluginLogSearch("tesla -online-check")).toEqual({
      include: "tesla",
      excludes: ["online-check"],
    });
  });

  it("supports multiple excludes", () => {
    expect(parsePluginLogSearch("tesla -online-check -heartbeat")).toEqual({
      include: "tesla",
      excludes: ["online-check", "heartbeat"],
    });
  });

  it("ignores a bare `-` token", () => {
    expect(parsePluginLogSearch("foo - bar")).toEqual({
      include: "foo bar",
      excludes: [],
    });
  });

  it("collapses extra whitespace in includes", () => {
    expect(parsePluginLogSearch("  foo   bar  ")).toEqual({
      include: "foo bar",
      excludes: [],
    });
  });
});
