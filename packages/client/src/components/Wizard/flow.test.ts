import { describe, expect, it } from "vitest";
import {
  activeSteps,
  backTargetId,
  nextStepId,
  resolveStepIndex,
  skipTargetId,
  type StepDef,
} from "./flow.ts";
import type { WizardNavState } from "@chargeha/shared";

describe("flow", () => {
  const step = (id: string, extra: Partial<StepDef> = {}): StepDef => ({
    id,
    label: id,
    useStep: () => ({ next: { kind: "hidden" }, view: null }),
    ...extra,
  });

  /** A flow shaped like the real one: core steps with a gated plugin group. */
  const FLOW: StepDef[] = [
    step("welcome"),
    step("vehicle-type"),
    step("tesla-a", { owner: "tesla" }),
    step("tesla-b", { owner: "tesla" }),
    step("inverter-type"),
    step("done"),
  ];

  const state = (overrides: Partial<WizardNavState> = {}): WizardNavState => ({
    stepId: "welcome",
    vehicleType: "",
    energyType: "",
    ...overrides,
  });

  describe("activeSteps", () => {
    it("includes unowned steps and excludes steps whose owner is not selected", () => {
      expect(activeSteps(FLOW, state()).map((s) => s.id)).toEqual([
        "welcome",
        "vehicle-type",
        "inverter-type",
        "done",
      ]);
    });

    it("includes a plugin's steps once its type is selected", () => {
      expect(
        activeSteps(FLOW, state({ vehicleType: "tesla" })).map((s) => s.id),
      ).toEqual([
        "welcome",
        "vehicle-type",
        "tesla-a",
        "tesla-b",
        "inverter-type",
        "done",
      ]);
    });

    it("keeps flow order", () => {
      const ids = activeSteps(FLOW, state({ vehicleType: "tesla" })).map((s) =>
        s.id
      );
      expect(ids.indexOf("tesla-a")).toBeLessThan(ids.indexOf("inverter-type"));
    });
  });

  describe("resolveStepIndex", () => {
    it("indexes against the active list, not the whole flow", () => {
      // inverter-type is 5th, 3rd with tesla's steps gated off, 5th again when they return.
      expect(resolveStepIndex(FLOW, state({ stepId: "inverter-type" }))).toBe(
        2,
      );
      expect(
        resolveStepIndex(
          FLOW,
          state({ stepId: "inverter-type", vehicleType: "tesla" }),
        ),
      ).toBe(4);
    });

    it("lands on the next step still in the list when the stored step is gated off", () => {
      // tesla-b is gone after switching away, so resume at the first surviving step after it.
      const index = resolveStepIndex(FLOW, state({ stepId: "tesla-b" }));
      expect(activeSteps(FLOW, state())[index].id).toBe("inverter-type");
    });

    it("starts at the first step when the id is not in the flow at all", () => {
      expect(resolveStepIndex(FLOW, state({ stepId: "bogus" }))).toBe(0);
    });

    it("lands on the last surviving step when nothing after the stored one survives", () => {
      const flow = [
        step("welcome"),
        step("gated", { owner: "unpicked" }),
        step("also-gated", { owner: "unpicked" }),
      ];
      expect(resolveStepIndex(flow, state({ stepId: "gated" }))).toBe(0);
    });
  });

  describe("nextStepId", () => {
    it("returns the following step in the active list", () => {
      expect(nextStepId(FLOW, state({ stepId: "welcome" }))).toBe(
        "vehicle-type",
      );
    });

    it("skips over steps the selections exclude", () => {
      expect(nextStepId(FLOW, state({ stepId: "vehicle-type" }))).toBe(
        "inverter-type",
      );
    });

    it("includes a plugin's steps once its type is selected", () => {
      expect(
        nextStepId(
          FLOW,
          state({ stepId: "vehicle-type", vehicleType: "tesla" }),
        ),
      ).toBe("tesla-a");
    });

    it("returns null at the end of the flow", () => {
      expect(nextStepId(FLOW, state({ stepId: "done" }))).toBeNull();
    });
  });

  describe("backTargetId", () => {
    it("steps back one when the previous step has the same owner", () => {
      expect(
        backTargetId(FLOW, state({ stepId: "tesla-b", vehicleType: "tesla" })),
      ).toBe("tesla-a");
    });

    it("steps back one between unowned steps", () => {
      expect(backTargetId(FLOW, state({ stepId: "done" }))).toBe(
        "inverter-type",
      );
    });

    it("steps back over a plugin's whole block rather than into its end", () => {
      // Back from inverter-type belongs at the choice that led into Tesla setup.
      expect(
        backTargetId(
          FLOW,
          state({ stepId: "inverter-type", vehicleType: "tesla" }),
        ),
      ).toBe("vehicle-type");
    });

    it("returns null on the first step", () => {
      expect(backTargetId(FLOW, state({ stepId: "welcome" }))).toBeNull();
    });
  });

  describe("skipTargetId", () => {
    it("skips one step when the current step has no owner", () => {
      expect(skipTargetId(FLOW, state({ stepId: "welcome" }))).toBe(
        "vehicle-type",
      );
    });

    it("skips a plugin.s whole block from inside it", () => {
      expect(
        skipTargetId(FLOW, state({ stepId: "tesla-a", vehicleType: "tesla" })),
      ).toBe("inverter-type");
    });

    it("returns null on the last step", () => {
      expect(skipTargetId(FLOW, state({ stepId: "done" }))).toBeNull();
    });

    it("returns null when nothing follows the block — there is no landing spot", () => {
      // A plugin's setup run is only its block, so skipping any step abandons the run.
      const flow = [
        step("tesla-a", { owner: "tesla" }),
        step("tesla-b", { owner: "tesla" }),
      ];
      expect(
        skipTargetId(flow, state({ stepId: "tesla-a", vehicleType: "tesla" })),
      ).toBeNull();
    });
  });
});
