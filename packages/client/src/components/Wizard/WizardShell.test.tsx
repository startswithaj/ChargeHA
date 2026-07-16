import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { WizardShell, type WizardStepConfig } from "./WizardShell.tsx";
import {
  useWizardNextControl,
  type WizardNextControl,
} from "./wizardNextControl.ts";
import {
  useWizardState,
  type WizardState,
} from "../../hooks/useWizardState.ts";

vi.mock("../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(),
}));

describe("WizardShell", () => {
  const mockSetStepId = vi.fn();
  let currentStepId = "welcome";

  /** Full 14-step list (Tesla vehicle + inverter-setup energy step). */
  const FULL_STEP_IDS = [
    "welcome",
    "timezone",
    "vehicle-type",
    "tesla-key-generation",
    "tesla-public-key-hosting",
    "tesla-credentials",
    "tesla-partner-registration",
    "tesla-auth",
    "tesla-vehicle-selection",
    "tesla-virtual-key-pairing",
    "inverter-type",
    "inverter-setup",
    "home-location",
    "done",
  ];

  const FULL_STEP_LABELS = [
    "Welcome",
    "Timezone",
    "Vehicle Type",
    "Tesla Key Generation",
    "Tesla Public Key Hosting",
    "Tesla Credentials",
    "Tesla Partner Registration",
    "Tesla Authorization",
    "Tesla Vehicle Selection",
    "Tesla Virtual Key Pairing",
    "Inverter Type",
    "Inverter Setup",
    "Home Location",
    "Done",
  ];

  const makeSteps = (
    ids = FULL_STEP_IDS,
    labels = FULL_STEP_LABELS,
  ): WizardStepConfig[] => {
    return labels.map((label, i) => ({
      id: ids[i],
      label,
      render: () => <div data-testid={`step-content-${i}`}>{label} content
      </div>,
    }));
  };

  /** Core-only steps (no vehicle or energy plugin steps — e.g., simulated + skip). */
  const makeCoreOnlySteps = (): WizardStepConfig[] => {
    const ids = [
      "welcome",
      "timezone",
      "vehicle-type",
      "inverter-type",
      "home-location",
      "done",
    ];
    const labels = [
      "Welcome",
      "Timezone",
      "Vehicle Type",
      "Inverter Type",
      "Home Location",
      "Done",
    ];
    return makeSteps(ids, labels);
  };

  /** Update the mocked useWizardState return value, merging overrides over defaults. */
  const setWizardState = (overrides: Partial<WizardState> = {}): void => {
    vi.mocked(useWizardState).mockReturnValue({
      stepId: currentStepId,
      vehicleType: "",
      energyType: "",
      setStepId: mockSetStepId,
      commitSelection: vi.fn(),
      isLoading: false,
      ...overrides,
    });
  };

  /** Set the wizard mock state to a given step ID. */
  const setMockStepId = (stepId: string) => {
    currentStepId = stepId;
    // When setStepId is called (navigation), update the mock state and re-render
    mockSetStepId.mockImplementation((id: string) => {
      currentStepId = id;
      setWizardState({ stepId: id });
    });
    setWizardState({ stepId });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setMockStepId("welcome");
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders step indicator matching step count", () => {
    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();

    const indicator = screen.getByRole("navigation", { name: "Wizard steps" });
    const dots = indicator.querySelectorAll("[class*='stepDot']");
    expect(dots).toHaveLength(14);
  });

  it("renders correct step count for core-only steps", () => {
    renderWithProviders(<WizardShell steps={makeCoreOnlySteps()} />);

    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();

    const indicator = screen.getByRole("navigation", { name: "Wizard steps" });
    const dots = indicator.querySelectorAll("[class*='stepDot']");
    expect(dots).toHaveLength(6);
  });

  it("renders Back, Next, and Skip buttons", () => {
    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("Back button is disabled on first step", () => {
    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("renders empty state when no steps config is provided", () => {
    renderWithProviders(<WizardShell />);

    expect(screen.getByText("No wizard steps configured.")).toBeInTheDocument();
  });

  // ---- Navigation ----

  it("clicking Next advances to next step", () => {
    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Verify setStepId was called with the next step's ID
    expect(mockSetStepId).toHaveBeenCalledWith("timezone");
  });

  it("clicking Back goes to previous step", () => {
    // Start at step 3 via mock state
    setMockStepId("vehicle-type");

    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 3 of 14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockSetStepId).toHaveBeenCalledWith("timezone");
  });

  it("clicking Skip advances to next step", () => {
    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(mockSetStepId).toHaveBeenCalledWith("timezone");
  });

  it("clicking Skip inside a plugin group skips the whole group", () => {
    const steps = makeSteps().map((s) =>
      s.id.startsWith("tesla-") ? { ...s, group: "tesla" } : s
    );
    setMockStepId("tesla-credentials");

    renderWithProviders(<WizardShell steps={steps} />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    // Skips the remaining tesla steps straight to inverter-type.
    expect(mockSetStepId).toHaveBeenCalledWith("inverter-type");
  });

  it("resumes at saved step from DB", () => {
    setMockStepId("tesla-credentials");

    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 6 of 14")).toBeInTheDocument();
    expect(screen.getByText("Tesla Credentials")).toBeInTheDocument();
  });

  it("clamps to step after vehicle-type when stored ID is unknown", () => {
    setMockStepId("nonexistent-step");

    renderWithProviders(<WizardShell steps={makeSteps()} />);

    // Clamped to step after vehicle-type (index 3 = Tesla Key Generation in full list)
    expect(screen.getByText("Step 4 of 14")).toBeInTheDocument();
    expect(screen.getByText("Tesla Key Generation")).toBeInTheDocument();
  });

  it("clamps to step after vehicle-type when stored step is a removed plugin step", () => {
    // Simulate: user had Tesla steps, then switched to simulated (core-only steps)
    setMockStepId("tesla-credentials");

    renderWithProviders(<WizardShell steps={makeCoreOnlySteps()} />);

    // Clamped to step after vehicle-type (index 3 = Inverter Type in core-only list)
    expect(screen.getByText("Step 4 of 6")).toBeInTheDocument();
    expect(screen.getByText("Inverter Type")).toBeInTheDocument();
  });

  it("falls back to step 0 when vehicle-type step not present", () => {
    const minimalSteps = makeSteps(["a", "b", "c"], ["A", "B", "C"]);
    setMockStepId("nonexistent");

    renderWithProviders(<WizardShell steps={minimalSteps} />);

    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  // ---- Step content rendering ----

  it("renders the correct step content for each step index", () => {
    const steps = makeSteps();
    renderWithProviders(<WizardShell steps={steps} />);

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();

    // Step 0 (Welcome)
    expect(screen.getByTestId("step-content-0")).toBeInTheDocument();
    expect(screen.getByText("Welcome content")).toBeInTheDocument();
  });

  // ---- Last step ----

  it("shows Finish button on last step instead of Next and Skip", () => {
    setMockStepId("done");

    renderWithProviders(<WizardShell steps={makeSteps()} />);

    expect(screen.getByText("Step 14 of 14")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).not
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not
      .toBeInTheDocument();
  });

  it("calls onComplete when Finish is clicked on last step", () => {
    const onComplete = vi.fn();
    setMockStepId("done");

    renderWithProviders(
      <WizardShell steps={makeSteps()} onComplete={onComplete} />,
    );

    expect(screen.getByText("Step 14 of 14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ---- Step indicator ----

  it("marks active step dot in indicator", async () => {
    setMockStepId("tesla-key-generation");

    renderWithProviders(<WizardShell steps={makeSteps()} />);

    await waitFor(() => {
      expect(screen.getByText("Step 4 of 14")).toBeInTheDocument();
    });

    const indicator = screen.getByRole("navigation", { name: "Wizard steps" });
    const dots = indicator.querySelectorAll("[class*='stepDot']");

    // Steps before current should be completed
    Array.from({ length: 3 }).forEach((_, i) => {
      expect(dots[i].className).toContain("stepDotCompleted");
    });

    // Current step should be active
    expect(dots[3].className).toContain("stepDotActive");

    // Steps after current should be neither active nor completed
    expect(dots[4].className).not.toContain("stepDotActive");
    expect(dots[4].className).not.toContain("stepDotCompleted");
  });

  // ---- Dynamic recomposition ----

  it("recomputes progress bar when step list changes", () => {
    // Start with full list
    const { rerender } = renderWithProviders(
      <WizardShell steps={makeSteps()} />,
    );

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();

    // Switch to core-only list
    rerender(<WizardShell steps={makeCoreOnlySteps()} />);

    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
  });

  it("hides the Finish button but keeps Back on a step flagged hideNext", () => {
    const steps = makeCoreOnlySteps();
    steps[steps.length - 1] = { ...steps[steps.length - 1], hideNext: true };
    setMockStepId("done");
    renderWithProviders(<WizardShell steps={steps} />);

    expect(screen.queryByRole("button", { name: "Finish" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByTestId("step-content-5")).toBeInTheDocument();
  });

  it("shows the Finish button on the same step without hideNext", () => {
    setMockStepId("done");
    renderWithProviders(<WizardShell steps={makeCoreOnlySteps()} />);

    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("shows an Exit setup button when onExit is provided and calls it on click", () => {
    const onExit = vi.fn();
    renderWithProviders(
      <WizardShell steps={makeCoreOnlySteps()} onExit={onExit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit setup" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("hides the Exit setup button when onExit is not provided", () => {
    renderWithProviders(<WizardShell steps={makeCoreOnlySteps()} />);

    expect(screen.queryByRole("button", { name: "Exit setup" }))
      .not.toBeInTheDocument();
  });

  describe("step Next control", () => {
    const makeControlledSteps = (
      control: WizardNextControl,
    ): WizardStepConfig[] => {
      const ControlledStep = () => {
        useWizardNextControl(control);
        return <div>controlled step</div>;
      };
      const steps = makeCoreOnlySteps();
      steps[0] = { ...steps[0], render: () => <ControlledStep /> };
      return steps;
    };

    it("disables Next and shows the hint while canProceed is false", () => {
      setMockStepId("welcome");
      renderWithProviders(
        <WizardShell
          steps={makeControlledSteps({
            canProceed: false,
            hint: "Test the connection to continue",
          })}
        />,
      );

      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
      expect(screen.getByText("Test the connection to continue"))
        .toBeInTheDocument();
    });

    it("advances only after onBeforeNext resolves true, showing the pending label", async () => {
      setMockStepId("welcome");
      let resolveSave = (_ok: boolean) => {};
      const onBeforeNext = () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        });
      renderWithProviders(
        <WizardShell
          steps={makeControlledSteps({
            canProceed: true,
            pendingLabel: "Saving...",
            onBeforeNext,
          })}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(await screen.findByText("Saving...")).toBeInTheDocument();
      expect(mockSetStepId).not.toHaveBeenCalled();

      resolveSave(true);
      await waitFor(() =>
        expect(mockSetStepId).toHaveBeenCalledWith("timezone")
      );
    });

    it("stays on the step when onBeforeNext resolves false", async () => {
      setMockStepId("welcome");
      renderWithProviders(
        <WizardShell
          steps={makeControlledSteps({
            canProceed: true,
            onBeforeNext: () => Promise.resolve(false),
          })}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Next" })).toBeEnabled()
      );
      expect(mockSetStepId).not.toHaveBeenCalled();
    });
  });
});
