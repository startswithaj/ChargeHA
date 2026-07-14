import { describe, expect, it } from "vitest";
import {
  DemoGatedError,
  DemoUnhandledError,
  DemoUnhandledMutationError,
  resolveDemoMutation,
  resolveDemoQuery,
} from "./resolveDemoOp.ts";

describe("resolveDemoQuery", () => {
  it("throws DemoGatedError for a gated path", () => {
    expect(() => resolveDemoQuery("plugin.vehicle.tesla.getConfig", undefined))
      .toThrow(
        DemoGatedError,
      );
  });

  it("throws DemoUnhandledError for an unknown path", () => {
    expect(() => resolveDemoQuery("does.not.exist", undefined)).toThrow(
      DemoUnhandledError,
    );
  });
});

describe("resolveDemoMutation", () => {
  it("throws DemoGatedError for a gated mutation", () => {
    expect(() =>
      resolveDemoMutation("plugin.vehicle.tesla.setConfig", undefined)
    ).toThrow(
      DemoGatedError,
    );
  });

  it("throws DemoUnhandledMutationError for an unknown mutation path", () => {
    expect(() => resolveDemoMutation("does.not.exist", undefined)).toThrow(
      DemoUnhandledMutationError,
    );
  });
});
