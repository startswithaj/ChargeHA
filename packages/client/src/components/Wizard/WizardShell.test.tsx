import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { WizardShell } from "./WizardShell.tsx";
import {
  advanceOnly,
  type StepDef,
  type WizardNext,
  type WizardStore,
} from "./flow.ts";
import { useWizardAdvance } from "./wizardAdvance.ts";

describe("WizardShell", () => {
  const mockPatch = vi.fn();
  let currentStepId = "welcome";

  /** Full 14-step flow (Tesla vehicle + inverter-setup energy step). */
  const FULL_STEPS: [string, string][] = [
    ["welcome", "Welcome"],
    ["timezone", "Timezone"],
    ["vehicle-type", "Vehicle Type"],
    ["tesla-key-generation", "Tesla Key Generation"],
    ["tesla-public-key-hosting", "Tesla Public Key Hosting"],
    ["tesla-credentials", "Tesla Credentials"],
    ["tesla-partner-registration", "Tesla Partner Registration"],
    ["tesla-auth", "Tesla Authorization"],
    ["tesla-vehicle-selection", "Tesla Vehicle Selection"],
    ["tesla-virtual-key-pairing", "Tesla Virtual Key Pairing"],
    ["inverter-type", "Inverter Type"],
    ["inverter-setup", "Inverter Setup"],
    ["home-location", "Home Location"],
    ["done", "Done"],
  ];

  const CORE_ONLY_IDS = [
    "welcome",
    "timezone",
    "vehicle-type",
    "inverter-type",
    "home-location",
    "done",
  ];

  const makeFlow = (entries = FULL_STEPS): StepDef[] =>
    entries.map(([id, label], i) => ({
      id,
      label,
      useStep: () => ({
        next: { kind: "ready", hint: null, onNext: advanceOnly },
        view: <div data-testid={`step-content-${i}`}>{label} content</div>,
      }),
    }));

  /**
   * The full flow, with the plugin steps gated off — the shape the real wizard
   * has when a vehicle type without setup steps is selected. Core steps stay in
   * the flow; only `when` decides they aren't in the list.
   */
  const makeCoreOnlyFlow = (): StepDef[] =>
    makeFlow().map((step) => gateOff(step, !CORE_ONLY_IDS.includes(step.id)));

  /** Give a step an owner nothing has selected, so it drops out of the list. */
  const gateOff = (step: StepDef, off: boolean): StepDef =>
    off ? { ...step, owner: "unpicked" } : step;

  const makeStore = (overrides: Partial<WizardStore> = {}): WizardStore => ({
    state: { stepId: currentStepId, vehicleType: "", energyType: "" },
    patch: mockPatch,
    isLoading: false,
    ...overrides,
  });

  const setStepId = (stepId: string) => {
    currentStepId = stepId;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setStepId("welcome");
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders step indicator matching step count", () => {
    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();

    const indicator = screen.getByRole("navigation", { name: "Wizard steps" });
    const dots = indicator.querySelectorAll("[class*='stepDot']");
    expect(dots).toHaveLength(14);
  });

  it("counts only the steps the current selections include", () => {
    renderWithProviders(
      <WizardShell
        flow={makeCoreOnlyFlow()}
        store={makeStore()}
        basePath="/wizard"
      />,
    );

    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();

    const indicator = screen.getByRole("navigation", { name: "Wizard steps" });
    const dots = indicator.querySelectorAll("[class*='stepDot']");
    expect(dots).toHaveLength(6);
  });

  it("renders Back, Next, and Skip buttons", () => {
    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("Back is disabled on the first step when there is nothing to back out to", () => {
    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("Back on the first step calls onBackOut when provided", () => {
    const onBackOut = vi.fn();
    renderWithProviders(
      <WizardShell
        flow={makeFlow()}
        store={makeStore()}
        basePath="/wizard"
        onBackOut={onBackOut}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBackOut).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when the flow has no steps", () => {
    renderWithProviders(
      <WizardShell flow={[]} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("No wizard steps configured.")).toBeInTheDocument();
  });

  it("renders a loading state while the store is loading", () => {
    renderWithProviders(
      <WizardShell
        flow={makeFlow()}
        store={makeStore({ isLoading: true })}
        basePath="/wizard"
      />,
    );

    expect(screen.getByText("Loading wizard...")).toBeInTheDocument();
  });

  // ---- Navigation ----

  it("clicking Next advances to next step", async () => {
    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Next runs the step's handler before advancing, so the patch lands a tick
    // later even when that handler does nothing.
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({ stepId: "timezone" })
    );
  });

  it("clicking Back goes to previous step", () => {
    setStepId("vehicle-type");

    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("Step 3 of 14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockPatch).toHaveBeenCalledWith({ stepId: "timezone" });
  });

  it("clicking Skip advances to next step", () => {
    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(mockPatch).toHaveBeenCalledWith({ stepId: "timezone" });
  });

  it("Back after skipping a plugin's steps returns to the choice that led in", () => {
    const flow = makeFlow().map((s) =>
      s.id.startsWith("tesla-") ? { ...s, owner: "tesla" } : s
    );
    setStepId("inverter-type");

    renderWithProviders(
      <WizardShell
        flow={flow}
        store={makeStore({
          state: {
            stepId: "inverter-type",
            vehicleType: "tesla",
            energyType: "",
          },
        })}
        basePath="/wizard"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // Not tesla-virtual-key-pairing — the far end of the block just escaped.
    expect(mockPatch).toHaveBeenCalledWith({ stepId: "vehicle-type" });
  });

  it("Back inside a plugin's steps still moves one step at a time", () => {
    const flow = makeFlow().map((s) =>
      s.id.startsWith("tesla-") ? { ...s, owner: "tesla" } : s
    );
    setStepId("tesla-credentials");

    renderWithProviders(
      <WizardShell
        flow={flow}
        store={makeStore({
          state: {
            stepId: "tesla-credentials",
            vehicleType: "tesla",
            energyType: "",
          },
        })}
        basePath="/wizard"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockPatch).toHaveBeenCalledWith({
      stepId: "tesla-public-key-hosting",
    });
  });

  it("clicking Skip inside a plugin group skips the whole group", () => {
    const flow = makeFlow().map((s) =>
      s.id.startsWith("tesla-") ? { ...s, owner: "tesla" } : s
    );
    setStepId("tesla-credentials");

    renderWithProviders(
      <WizardShell
        flow={flow}
        store={makeStore({
          state: {
            stepId: "tesla-credentials",
            vehicleType: "tesla",
            energyType: "",
          },
        })}
        basePath="/wizard"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    // Skips the remaining tesla steps straight to inverter-type.
    expect(mockPatch).toHaveBeenCalledWith({ stepId: "inverter-type" });
  });

  it("resumes at saved step from the store", () => {
    setStepId("tesla-credentials");

    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("Step 6 of 14")).toBeInTheDocument();
    expect(screen.getByText("Tesla Credentials")).toBeInTheDocument();
  });

  // ---- Resolving a step id that isn't in the list ----

  it("lands on the next step still in the list when the stored step is gated off", () => {
    // The user had Tesla steps, then switched to a type without them.
    setStepId("tesla-credentials");

    renderWithProviders(
      <WizardShell
        flow={makeCoreOnlyFlow()}
        store={makeStore()}
        basePath="/wizard"
      />,
    );

    // Resumes at the first step still in the list at or after where they were,
    // rather than restarting setup from the top.
    expect(screen.getByText("Step 4 of 6")).toBeInTheDocument();
    expect(screen.getByText("Inverter Type")).toBeInTheDocument();
  });

  it("starts at the first step when the stored id is not in the flow at all", () => {
    setStepId("nonexistent-step");

    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("lands on the last step when every step after the stored one is gated off", () => {
    setStepId("home-location");
    const flow = makeFlow().map((s) =>
      gateOff(s, s.id === "home-location" || s.id === "done")
    );

    renderWithProviders(
      <WizardShell flow={flow} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("Step 12 of 12")).toBeInTheDocument();
  });

  // ---- Step content rendering ----

  it("renders the step content for the current step", () => {
    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByTestId("step-content-0")).toBeInTheDocument();
    expect(screen.getByText("Welcome content")).toBeInTheDocument();
  });

  // ---- Last step ----

  it("shows Finish button on last step instead of Next and Skip", () => {
    setStepId("done");

    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("Step 14 of 14")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).not
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not
      .toBeInTheDocument();
  });

  it("calls onComplete when Finish is clicked on last step", async () => {
    const onComplete = vi.fn();
    setStepId("done");

    renderWithProviders(
      <WizardShell
        flow={makeFlow()}
        store={makeStore()}
        basePath="/wizard"
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  // ---- Step indicator ----

  it("marks active step dot in indicator", async () => {
    setStepId("tesla-key-generation");

    renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

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

  it("recomputes progress bar when the selections change which steps exist", () => {
    const { rerender } = renderWithProviders(
      <WizardShell flow={makeFlow()} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.getByText("Step 1 of 14")).toBeInTheDocument();

    rerender(
      <WizardShell
        flow={makeCoreOnlyFlow()}
        store={makeStore()}
        basePath="/wizard"
      />,
    );

    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
  });

  const hideNextOnDone = (s: StepDef): StepDef => {
    if (s.id !== "done") return s;
    return {
      ...s,
      useStep: () => ({
        next: { kind: "hidden" },
        view: <div data-testid="step-content-13">Done content</div>,
      }),
    };
  };

  it("hides the Finish button but keeps Back when the step's Next is hidden", () => {
    const flow = makeCoreOnlyFlow().map(hideNextOnDone);
    setStepId("done");
    renderWithProviders(
      <WizardShell flow={flow} store={makeStore()} basePath="/wizard" />,
    );

    expect(screen.queryByRole("button", { name: "Finish" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByTestId("step-content-13")).toBeInTheDocument();
  });

  it("shows the Finish button on the same step when its Next is ready", () => {
    setStepId("done");
    renderWithProviders(
      <WizardShell
        flow={makeCoreOnlyFlow()}
        store={makeStore()}
        basePath="/wizard"
      />,
    );

    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("shows an Exit setup button when onExit is provided and calls it on click", () => {
    const onExit = vi.fn();
    renderWithProviders(
      <WizardShell
        flow={makeCoreOnlyFlow()}
        store={makeStore()}
        basePath="/wizard"
        onExit={onExit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit setup" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("hides the Exit setup button when onExit is not provided", () => {
    renderWithProviders(
      <WizardShell
        flow={makeCoreOnlyFlow()}
        store={makeStore()}
        basePath="/wizard"
      />,
    );

    expect(screen.queryByRole("button", { name: "Exit setup" }))
      .not.toBeInTheDocument();
  });

  describe("step Next", () => {
    const withNext = (s: StepDef, next: WizardNext): StepDef => {
      if (s.id !== "welcome") return s;
      return {
        ...s,
        useStep: () => ({ next, view: <div>controlled step</div> }),
      };
    };

    const flowWhereWelcome = (next: WizardNext): StepDef[] =>
      makeFlow().map((s) => withNext(s, next));

    const renderNext = (next: WizardNext) => {
      setStepId("welcome");
      renderWithProviders(
        <WizardShell
          flow={flowWhereWelcome(next)}
          store={makeStore()}
          basePath="/wizard"
        />,
      );
    };

    it("disables Next and shows the reason while the step is blocked", () => {
      renderNext({
        kind: "blocked",
        reason: "Test the connection to continue",
      });

      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
      expect(screen.getByText("Test the connection to continue"))
        .toBeInTheDocument();
    });

    it("disables Next without a hint while the step is loading", () => {
      renderNext({ kind: "loading" });

      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
      // No hint yet — a reason that flips to ready milliseconds after mount
      // reads as a flash in the nav.
      expect(screen.queryByText(/continue/)).not.toBeInTheDocument();
    });

    it("hides Next entirely when the step's Next is hidden", () => {
      renderNext({ kind: "hidden" });

      expect(screen.queryByRole("button", { name: "Next" }))
        .not.toBeInTheDocument();
    });

    it("advances only after onNext resolves, showing the pending label", async () => {
      let resolveSave = () => {};
      renderNext({
        kind: "ready",
        hint: "Next saves",
        onNext: () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      });

      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(await screen.findByText("Saving...")).toBeInTheDocument();
      expect(mockPatch).not.toHaveBeenCalled();

      resolveSave();
      await waitFor(() =>
        expect(mockPatch).toHaveBeenCalledWith({ stepId: "timezone" })
      );
    });

    it("stays on the step and shows the reason when onNext throws", async () => {
      renderNext({
        kind: "ready",
        hint: "Next saves",
        onNext: () => Promise.reject(new Error("Could not reach the inverter")),
      });

      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      expect(await screen.findByText("Could not reach the inverter"))
        .toBeInTheDocument();
      expect(mockPatch).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });
  });

  // ---- Advance ----

  describe("advance", () => {
    it("writes the selection and the step it leads to in one patch", () => {
      const AdvancingStep = () => {
        const advance = useWizardAdvance();
        return (
          <button
            type="button"
            onClick={() => advance({ vehicleType: "tesla" })}
          >
            pick tesla
          </button>
        );
      };
      // Tesla's steps are in the list only while tesla is selected.
      const flow: StepDef[] = [
        {
          id: "vehicle-type",
          label: "Vehicle Type",
          useStep: () => ({
            next: { kind: "ready", hint: null, onNext: advanceOnly },
            view: <AdvancingStep />,
          }),
        },
        {
          id: "tesla-key-generation",
          label: "Tesla Key Generation",
          owner: "tesla",
          useStep: () => ({ next: { kind: "hidden" }, view: <div>tesla</div> }),
        },
        {
          id: "done",
          label: "Done",
          useStep: () => ({ next: { kind: "hidden" }, view: <div>done</div> }),
        },
      ];
      setStepId("vehicle-type");

      renderWithProviders(
        <WizardShell flow={flow} store={makeStore()} basePath="/wizard" />,
      );

      fireEvent.click(screen.getByRole("button", { name: "pick tesla" }));

      // The next step is read from the flow the new selection produces, so the
      // step id and the type that puts it in the list land together.
      expect(mockPatch).toHaveBeenCalledWith({
        vehicleType: "tesla",
        stepId: "tesla-key-generation",
      });
    });

    it("skips a plugin's steps when the selection does not enable them", () => {
      const AdvancingStep = () => {
        const advance = useWizardAdvance();
        return (
          <button
            type="button"
            onClick={() => advance({ vehicleType: "simulated" })}
          >
            pick simulated
          </button>
        );
      };
      const flow: StepDef[] = [
        {
          id: "vehicle-type",
          label: "Vehicle Type",
          useStep: () => ({
            next: { kind: "ready", hint: null, onNext: advanceOnly },
            view: <AdvancingStep />,
          }),
        },
        {
          id: "tesla-key-generation",
          label: "Tesla Key Generation",
          owner: "tesla",
          useStep: () => ({ next: { kind: "hidden" }, view: <div>tesla</div> }),
        },
        {
          id: "done",
          label: "Done",
          useStep: () => ({ next: { kind: "hidden" }, view: <div>done</div> }),
        },
      ];
      setStepId("vehicle-type");

      renderWithProviders(
        <WizardShell flow={flow} store={makeStore()} basePath="/wizard" />,
      );

      fireEvent.click(screen.getByRole("button", { name: "pick simulated" }));

      expect(mockPatch).toHaveBeenCalledWith({
        vehicleType: "simulated",
        stepId: "done",
      });
    });
  });
});
