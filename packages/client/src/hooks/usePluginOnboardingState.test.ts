import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  clearPluginOnboarding,
  usePluginOnboardingState,
} from "./usePluginOnboardingState.ts";

describe("usePluginOnboardingState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns defaultStepId when localStorage has no value", () => {
    const { result } = renderHook(() =>
      usePluginOnboardingState("tesla", "credentials", "vehicle")
    );
    expect(result.current.state.stepId).toBe("credentials");
  });

  describe("clearPluginOnboarding", () => {
    it("wipes a plugin's stored run so the next launch starts fresh", () => {
      localStorage.setItem(
        "chargeha-plugin-onboarding-tesla",
        JSON.stringify("tesla-auth"),
      );

      clearPluginOnboarding("tesla");

      expect(localStorage.getItem("chargeha-plugin-onboarding-tesla"))
        .toBeNull();
      // A fresh mount after clearing starts at the default step, not the
      // half-finished one.
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "key-generation", "vehicle")
      );
      expect(result.current.state.stepId).toBe("key-generation");
    });

    it("only clears the named plugin", () => {
      localStorage.setItem(
        "chargeha-plugin-onboarding-tesla",
        JSON.stringify("tesla-auth"),
      );
      localStorage.setItem(
        "chargeha-plugin-onboarding-fronius_local",
        JSON.stringify("fronius-setup"),
      );

      clearPluginOnboarding("tesla");

      expect(localStorage.getItem("chargeha-plugin-onboarding-tesla"))
        .toBeNull();
      expect(localStorage.getItem("chargeha-plugin-onboarding-fronius_local"))
        .toBe(JSON.stringify("fronius-setup"));
    });
  });

  it("returns stored value from localStorage", () => {
    localStorage.setItem(
      "chargeha-plugin-onboarding-tesla",
      JSON.stringify("vehicle-select"),
    );
    const { result } = renderHook(() =>
      usePluginOnboardingState("tesla", "credentials", "vehicle")
    );
    expect(result.current.state.stepId).toBe("vehicle-select");
  });

  it("uses plugin-specific localStorage key", () => {
    localStorage.setItem(
      "chargeha-plugin-onboarding-fronius",
      JSON.stringify("discover"),
    );
    const { result } = renderHook(() =>
      usePluginOnboardingState("tesla", "credentials", "vehicle")
    );
    // Different plugin key — should not see fronius value
    expect(result.current.state.stepId).toBe("credentials");
  });

  it("names the plugin as the selection that owns its steps", () => {
    const { result } = renderHook(() =>
      usePluginOnboardingState("tesla", "credentials", "vehicle")
    );
    // Its steps carry owner: "tesla"; saying nothing is selected would gate
    // every one of them out of the list.
    expect(result.current.state.vehicleType).toBe("tesla");
    expect(result.current.state.energyType).toBe("");
    expect(result.current.isLoading).toBe(false);
  });

  it("names an energy plugin on the energy side", () => {
    const { result } = renderHook(() =>
      usePluginOnboardingState("fronius_local", "setup", "energy")
    );
    expect(result.current.state.energyType).toBe("fronius_local");
    expect(result.current.state.vehicleType).toBe("");
  });

  describe("patch", () => {
    it("writes the step to localStorage", () => {
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials", "vehicle")
      );

      act(() => {
        result.current.patch({ stepId: "hosting" });
      });

      expect(localStorage.getItem("chargeha-plugin-onboarding-tesla")).toBe(
        JSON.stringify("hosting"),
      );
    });

    it("updates the returned step", () => {
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials", "vehicle")
      );

      act(() => {
        result.current.patch({ stepId: "vehicle-select" });
      });

      expect(result.current.state.stepId).toBe("vehicle-select");
    });

    it("ignores a patch that carries no step", () => {
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials", "vehicle")
      );

      act(() => {
        result.current.patch({ vehicleType: "tesla" });
      });

      expect(result.current.state.stepId).toBe("credentials");
      expect(localStorage.getItem("chargeha-plugin-onboarding-tesla"))
        .toBeNull();
    });
  });

  describe("clear", () => {
    it("removes localStorage value", () => {
      localStorage.setItem(
        "chargeha-plugin-onboarding-tesla",
        JSON.stringify("hosting"),
      );
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials", "vehicle")
      );

      act(() => {
        result.current.clear();
      });

      expect(localStorage.getItem("chargeha-plugin-onboarding-tesla"))
        .toBeNull();
    });

    it("reverts the step to defaultStepId after clear", () => {
      localStorage.setItem(
        "chargeha-plugin-onboarding-tesla",
        JSON.stringify("hosting"),
      );
      const { result } = renderHook(() =>
        usePluginOnboardingState("tesla", "credentials", "vehicle")
      );

      expect(result.current.state.stepId).toBe("hosting");

      act(() => {
        result.current.clear();
      });

      expect(result.current.state.stepId).toBe("credentials");
    });
  });
});
