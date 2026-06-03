import { describe, expect, it } from "vitest";
import {
  DemoGatedError,
  DemoUnhandledError,
  resolveDemoQuery,
} from "./resolveDemoOp.ts";

describe("resolveDemoQuery", () => {
  it("throws DemoGatedError for a gated path", () => {
    expect(() => resolveDemoQuery("tesla.getConfig", undefined)).toThrow(
      DemoGatedError,
    );
  });

  it("throws DemoUnhandledError for an unknown path", () => {
    expect(() => resolveDemoQuery("does.not.exist", undefined)).toThrow(
      DemoUnhandledError,
    );
  });
});
