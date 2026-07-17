import { describe, expect, it, vi } from "vitest";
import type { WizardNavState } from "@chargeha/shared";

const mocks = vi.hoisted(() => ({
  stub: { next: { kind: "hidden" as const }, view: null },
}));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  vehiclePluginSteps: {
    tesla: [
      {
        id: "tesla-key-gen",
        label: "Key Generation",
        useStep: () => mocks.stub,
      },
      { id: "tesla-auth", label: "Authorization", useStep: () => mocks.stub },
    ],
    simulated: [],
  },
  energyPluginSteps: {
    fronius_local: [
      {
        id: "fronius-setup",
        label: "Fronius Setup",
        useStep: () => mocks.stub,
      },
    ],
    simulated_energy: [],
  },
  vehiclePluginOptions: [],
  energyPluginOptions: [],
}));

import { activeSteps } from "./flow.ts";
import { wizardFlow } from "./wizardFlow.ts";

describe("wizardFlow", () => {
  const state = (overrides: Partial<WizardNavState> = {}): WizardNavState => ({
    stepId: "welcome",
    vehicleType: "",
    energyType: "",
    ...overrides,
  });

  const idsFor = (overrides: Partial<WizardNavState> = {}) =>
    activeSteps(wizardFlow, state(overrides)).map((s) => s.id);

  it("is core steps only when nothing is selected", () => {
    expect(idsFor()).toEqual([
      "welcome",
      "authentication",
      "timezone",
      "vehicle-type",
      "inverter-type",
      "home-location",
      "grid-voltage",
      "done",
    ]);
  });

  it("places vehicle plugin steps directly after vehicle-type", () => {
    const ids = idsFor({ vehicleType: "tesla" });
    expect(ids.indexOf("tesla-key-gen")).toBe(ids.indexOf("vehicle-type") + 1);
    expect(ids.indexOf("tesla-auth")).toBe(ids.indexOf("tesla-key-gen") + 1);
  });

  it("places energy plugin steps directly after inverter-type", () => {
    const ids = idsFor({ energyType: "fronius_local" });
    expect(ids.indexOf("fronius-setup")).toBe(ids.indexOf("inverter-type") + 1);
  });

  it("includes both vehicle and energy plugin steps", () => {
    expect(idsFor({ vehicleType: "tesla", energyType: "fronius_local" }))
      .toEqual([
        "welcome",
        "authentication",
        "timezone",
        "vehicle-type",
        "tesla-key-gen",
        "tesla-auth",
        "inverter-type",
        "fronius-setup",
        "home-location",
        "grid-voltage",
        "done",
      ]);
  });

  it("shows only the selected plugin's steps, never another's", () => {
    const ids = idsFor({ vehicleType: "simulated" });
    expect(ids).not.toContain("tesla-key-gen");
    expect(ids.indexOf("inverter-type")).toBe(ids.indexOf("vehicle-type") + 1);
  });

  it("adds no plugin steps for an unknown vehicle type", () => {
    const ids = idsFor({ vehicleType: "unknown" });
    expect(ids.indexOf("inverter-type")).toBe(ids.indexOf("vehicle-type") + 1);
  });

  it("adds no plugin steps for an unknown energy type", () => {
    const ids = idsFor({ energyType: "unknown" });
    expect(ids.indexOf("home-location")).toBe(ids.indexOf("inverter-type") + 1);
  });

  it("stamps each plugin's steps with the registry key that owns them", () => {
    const teslaSteps = wizardFlow.filter((s) => s.id.startsWith("tesla-"));
    expect(teslaSteps.length).toBeGreaterThan(0);
    teslaSteps.forEach((s) => expect(s.owner).toBe("tesla"));
  });

  it("leaves core steps unowned so they are always in the list", () => {
    const core = wizardFlow.filter((s) =>
      s.id === "welcome" || s.id === "done"
    );
    expect(core).toHaveLength(2);
    core.forEach((s) => expect(s.owner).toBeUndefined());
  });
});
