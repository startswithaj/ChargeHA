import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePluginOnboardingState } from "./usePluginOnboardingState.ts";

describe("usePluginOnboardingState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns defaultStepId when localStorage has no value", () => {
    const { result } = renderHook(() =>
      usePluginOnboardingState("tesla", "credentials")
    );
    expect(result.current.stepId).toBe("credentials");
  });

  it("returns stored value from localStorage", () => {
    localStorage.setItem(
      "chargeha-plugin-onboarding-tesla",
      JSON.stringify("vehicle-select"),
    );
    const { result } = renderHook(() =>
      usePluginOnboardingState("tesla", "credentials")
    );
    expect(result.current.stepId).toBe("vehicle-select");
  });

  it("uses plugin-specific localStorage key", () => {
    localStorage.setItem(
      "chargeha-plugin-onboarding-fronius",
      JSON.stringify("discover"),
    );
    const { result } = renderHook(() =>
      usePluginOnboardingState("tesla", "credentials")
    );
    // Different plugin key — should not see fronius value
    expect(result.current.stepId).toBe("credentials");
  });

  describe("setStepId", () => {
    it("writes to localStorage", () => {
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials")
      );

      act(() => {
        result.current.setStepId("hosting");
      });

      expect(localStorage.getItem("chargeha-plugin-onboarding-tesla")).toBe(
        JSON.stringify("hosting"),
      );
    });

    it("updates the returned stepId", () => {
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials")
      );

      act(() => {
        result.current.setStepId("vehicle-select");
      });

      expect(result.current.stepId).toBe("vehicle-select");
    });
  });

  describe("clear", () => {
    it("removes localStorage value", () => {
      localStorage.setItem(
        "chargeha-plugin-onboarding-tesla",
        JSON.stringify("hosting"),
      );
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials")
      );

      act(() => {
        result.current.clear();
      });

      expect(localStorage.getItem("chargeha-plugin-onboarding-tesla"))
        .toBeNull();
    });

    it("reverts stepId to defaultStepId after clear", () => {
      localStorage.setItem(
        "chargeha-plugin-onboarding-tesla",
        JSON.stringify("hosting"),
      );
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials")
      );

      expect(result.current.stepId).toBe("hosting");

      act(() => {
        result.current.clear();
      });

      expect(result.current.stepId).toBe("credentials");
    });
  });
});
