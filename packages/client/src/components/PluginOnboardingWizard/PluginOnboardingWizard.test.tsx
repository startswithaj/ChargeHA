import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setStepId: vi.fn(),
  clear: vi.fn(),
  stepId: { value: "step-a" },
}));

vi.mock("../../hooks/usePluginOnboardingState.ts", () => ({
  usePluginOnboardingState: vi.fn(() => ({
    stepId: mocks.stepId.value,
    setStepId: mocks.setStepId,
    clear: mocks.clear,
  })),
}));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  pluginComponents: {
    "comp-a": (props: Record<string, unknown>) => (
      <div data-testid="step-a-component">
        Content A
        <button type="button" onClick={props.onNext as () => void}>
          StepNext
        </button>
      </div>
    ),
    "comp-b": (props: Record<string, unknown>) => (
      <div data-testid="step-b-component">
        Content B
        <button type="button" onClick={props.onNext as () => void}>
          StepNext
        </button>
      </div>
    ),
    "comp-c": () => <div data-testid="step-c-component">Content C</div>,
  } as Record<string, React.FC>,
}));

vi.mock("../Wizard/StepIndicator.tsx", () => ({
  StepIndicator: (
    { total, current }: { total: number; current: number },
  ) => <div data-testid="step-indicator">{current + 1}/{total}</div>,
}));

vi.mock("../Wizard/WizardShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => `mock-${String(prop)}` }),
}));

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { PluginOnboardingWizard } from "./PluginOnboardingWizard.tsx";
import type { PluginWizardStep } from "@chargeha/plugins/componentRegistry";

describe("PluginOnboardingWizard", () => {
  const threeSteps: PluginWizardStep[] = [
    { id: "step-a", label: "Step A", componentKey: "comp-a" },
    { id: "step-b", label: "Step B", componentKey: "comp-b" },
    { id: "step-c", label: "Step C", componentKey: "comp-c" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stepId.value = "step-a";
  });
  afterEach(cleanup);

  const defaultProps = {
    pluginId: "test-plugin",
    pluginName: "Test Plugin",
    steps: threeSteps,
    onComplete: vi.fn(),
    onCancel: vi.fn(),
  };

  it("returns null when steps are empty", () => {
    renderWithProviders(
      <PluginOnboardingWizard {...defaultProps} steps={[]} />,
    );
    // When steps is empty the component returns null — no step indicator or nav
    expect(screen.queryByTestId("step-indicator")).not.toBeInTheDocument();
  });

  it("renders step indicator with correct total and current", () => {
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    expect(screen.getByTestId("step-indicator")).toHaveTextContent("1/3");
  });

  it.each([
    ["step-a", "Step 1 of 3", "Step A"],
    ["step-b", "Step 2 of 3", "Step B"],
  ])(
    "renders step header with step number and label on %s",
    (stepId, headerText, label) => {
      mocks.stepId.value = stepId;
      renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
      expect(screen.getByText(headerText)).toBeInTheDocument();
      // The label appears both in the header and step indicator labels
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    },
  );

  it("renders the step component", () => {
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    expect(screen.getByTestId("step-a-component")).toBeInTheDocument();
  });

  it.each([
    ["step-a", "Cancel"],
    ["step-a", "Skip"],
    ["step-a", "Next"],
    ["step-b", "Back"],
    ["step-b", "Skip"],
    ["step-b", "Next"],
    ["step-c", "Back"],
    ["step-c", "Finish"],
  ])("on %s, renders %s button", (stepId, name) => {
    mocks.stepId.value = stepId;
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    expect(screen.queryByRole("button", { name })).toBeInTheDocument();
  });

  it.each([
    ["step-a", "Back"],
    ["step-a", "Finish"],
    ["step-b", "Cancel"],
    ["step-b", "Finish"],
    ["step-c", "Cancel"],
    ["step-c", "Skip"],
    ["step-c", "Next"],
  ])("on %s, does not render %s button", (stepId, name) => {
    mocks.stepId.value = stepId;
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked on first step", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <PluginOnboardingWizard {...defaultProps} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("advances to next step when Next is clicked", () => {
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    // Click the navigation Next button (last one)
    const nextButtons = screen.getAllByRole("button", { name: "Next" });
    fireEvent.click(nextButtons[nextButtons.length - 1]);
    expect(mocks.setStepId).toHaveBeenCalledWith("step-b");
  });

  it("advances when Skip is clicked", () => {
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(mocks.setStepId).toHaveBeenCalledWith("step-b");
  });

  it("goes back when Back is clicked on middle step", () => {
    mocks.stepId.value = "step-b";
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mocks.setStepId).toHaveBeenCalledWith("step-a");
  });

  it("calls onComplete and clears state when Finish is clicked", () => {
    mocks.stepId.value = "step-c";
    const onComplete = vi.fn();
    renderWithProviders(
      <PluginOnboardingWizard {...defaultProps} onComplete={onComplete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows component not found text when componentKey is missing", () => {
    const steps: PluginWizardStep[] = [
      { id: "unknown", label: "Unknown Step", componentKey: "nonexistent" },
    ];
    mocks.stepId.value = "unknown";
    renderWithProviders(
      <PluginOnboardingWizard {...defaultProps} steps={steps} />,
    );
    expect(screen.getByText(/component not found/)).toBeInTheDocument();
  });

  it("falls back to step 0 when stepId does not match any step", () => {
    mocks.stepId.value = "nonexistent-step";
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    // Falls back to first step
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("step-a-component")).toBeInTheDocument();
  });

  it("updates URL via history.replaceState", () => {
    const spy = vi.spyOn(globalThis.history, "replaceState");
    renderWithProviders(<PluginOnboardingWizard {...defaultProps} />);
    expect(spy).toHaveBeenCalledWith(null, "", "/setup/test-plugin/step-a");
    spy.mockRestore();
  });
});
