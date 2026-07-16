import "@testing-library/jest-dom/vitest";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { assertExists } from "@std/assert";
import type { StepProps } from "./Wizard/WizardShell.tsx";

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  vehiclePluginOptions: [
    {
      id: "tesla",
      label: "Tesla",
      description: "Tesla Fleet API",
      iconKey: "car",
    },
    {
      id: "simulated",
      label: "Simulated",
      description: "Virtual vehicle",
      iconKey: "monitor",
      demoSetup: true,
    },
  ],
  vehiclePluginSteps: {
    tesla: [
      {
        id: "tesla-key-gen",
        label: "Key Generation",
        componentKey: "tesla-key-generation",
      },
      {
        id: "tesla-auth",
        label: "Authorization",
        componentKey: "tesla-auth",
      },
    ],
    simulated: [],
  },
  energyPluginSteps: {
    fronius_local: [
      {
        id: "fronius-setup",
        label: "Fronius Setup",
        componentKey: "fronius-local-setup",
      },
    ],
  },
  pluginComponents: {
    "tesla-key-generation": () => <div>Tesla Key Gen Component</div>,
    "fronius-local-setup": () => <div>Fronius Setup Component</div>,
  } as Record<string, React.FC>,
}));

vi.mock("../trpc.ts", () => ({
  trpc: {
    wizard: {
      status: {
        useQuery: vi.fn(() => ({
          data: { completed: true, firstRun: false },
        })),
      },
    },
  },
}));

vi.mock("../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    stepId: "welcome",
    vehicleType: "tesla",
    energyType: "fronius_local",
    setStepId: vi.fn(),
    commitSelection: vi.fn(),
    isLoading: false,
  })),
}));

vi.mock("./Wizard/WizardShell.tsx", () => ({
  WizardShell: (
    { steps, onComplete, onExit }: {
      steps: Array<{ id: string; label: string }>;
      onComplete: () => void;
      onExit?: () => void;
    },
  ) => (
    <div>
      <div data-testid="step-count">{steps.length}</div>
      {steps.map((s) => (
        <div key={s.id} data-testid={`step-${s.id}`}>{s.label}</div>
      ))}
      <button type="button" onClick={onComplete}>Complete</button>
      {onExit && <button type="button" onClick={onExit}>Exit</button>}
    </div>
  ),
}));

import {
  composeWizardSteps,
  renderPluginStep,
  WizardRouter,
} from "./WizardRouter.tsx";

describe("WizardRouter", () => {
  const stubStepProps: StepProps = {
    onNext: () => {},
    onBack: () => {},
    onSkip: () => {},
    onSkipTo: () => {},
    onSkipToEnd: () => {},
  };

  describe("composeWizardSteps", () => {
    it("returns only core steps for empty types", () => {
      const steps = composeWizardSteps("", "");
      const ids = steps.map((s) => s.id);
      expect(ids).toEqual([
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

    it("inserts vehicle plugin steps after vehicle-type", () => {
      const steps = composeWizardSteps("tesla", "");
      const ids = steps.map((s) => s.id);
      expect(ids).toContain("tesla-key-gen");
      expect(ids).toContain("tesla-auth");
      expect(ids.indexOf("tesla-key-gen")).toBe(
        ids.indexOf("vehicle-type") + 1,
      );
    });

    it("inserts energy plugin steps after inverter-type", () => {
      const steps = composeWizardSteps("", "fronius_local");
      const ids = steps.map((s) => s.id);
      expect(ids).toContain("fronius-setup");
      expect(ids.indexOf("fronius-setup")).toBe(
        ids.indexOf("inverter-type") + 1,
      );
    });

    it("inserts both vehicle and energy steps", () => {
      const steps = composeWizardSteps("tesla", "fronius_local");
      const ids = steps.map((s) => s.id);
      expect(ids).toEqual([
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

    it("renders the vehicle plugin step when component is registered", () => {
      const steps = composeWizardSteps("tesla", "");
      const step = steps.find((s) => s.id === "tesla-key-gen");
      assertExists(step);
      // Component IS registered in the mock — should render it
      const result = step.render(stubStepProps);
      expect(result).not.toBeNull();
    });

    it("returns null for vehicle plugin step when component is NOT registered", () => {
      const steps = composeWizardSteps("tesla", "");
      const step = steps.find((s) => s.id === "tesla-auth");
      assertExists(step);
      // "tesla-auth" componentKey is NOT in pluginComponents mock — should return null
      const result = step.render(stubStepProps);
      expect(result).toBeNull();
    });

    it("renders energy plugin step when component IS registered", () => {
      const steps = composeWizardSteps("", "fronius_local");
      const step = steps.find((s) => s.id === "fronius-setup");
      assertExists(step);
      // "fronius-local-setup" IS in pluginComponents mock — should render component
      const result = step.render(stubStepProps);
      expect(result).not.toBeNull();
    });

    it("uses fallback for unknown vehicle type", () => {
      const steps = composeWizardSteps("unknown", "");
      const ids = steps.map((s) => s.id);
      // No vehicle plugin steps added
      expect(ids.indexOf("inverter-type")).toBe(
        ids.indexOf("vehicle-type") + 1,
      );
    });

    it("uses fallback for unknown energy type", () => {
      const steps = composeWizardSteps("", "unknown");
      const ids = steps.map((s) => s.id);
      // No energy plugin steps added
      expect(ids.indexOf("home-location")).toBe(
        ids.indexOf("inverter-type") + 1,
      );
    });
  });

  describe("renderPluginStep", () => {
    it("returns null when component key is not in registry", () => {
      const result = renderPluginStep(
        "missing-key",
        {} as Record<string, React.ComponentType<StepProps>>,
        stubStepProps,
      );
      expect(result).toBeNull();
    });

    it("returns rendered component when key is in registry", () => {
      const Comp: React.FC<StepProps> = () => <div>hello</div>;
      const result = renderPluginStep(
        "k",
        { k: Comp } as Record<string, React.ComponentType<StepProps>>,
        stubStepProps,
      );
      expect(result).not.toBeNull();
    });
  });

  describe("WizardRouter component", () => {
    it("renders WizardShell with composed steps", () => {
      const onComplete = vi.fn();
      render(<WizardRouter onComplete={onComplete} />);

      // useWizardState returns tesla + fronius_local, so should have 11 steps
      expect(screen.getByTestId("step-count")).toHaveTextContent("11");
      expect(screen.getByTestId("step-tesla-key-gen")).toBeInTheDocument();
      expect(screen.getByTestId("step-fronius-setup")).toBeInTheDocument();
    });

    it("passes onComplete to WizardShell", async () => {
      const onComplete = vi.fn();
      render(<WizardRouter onComplete={onComplete} />);

      await userEvent.click(screen.getByText("Complete"));
      expect(onComplete).toHaveBeenCalled();
    });

    it("passes onExit to WizardShell when the wizard was previously completed", () => {
      render(<WizardRouter onComplete={vi.fn()} />);

      // wizard.status mock returns completed: true
      expect(screen.getByText("Exit")).toBeInTheDocument();
    });
  });
});
