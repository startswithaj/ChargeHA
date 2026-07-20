import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WizardShell } from "./WizardShell.tsx";
import type { StepDef, WizardStore } from "./flow.ts";
import type { WizardNavState } from "@chargeha/shared";

/**
 * A selection made on Next must survive the move.
 *
 * The wizard used to move twice for one click: the step applied its own
 * selection, then the shell moved again and recomputed the destination from
 * state that predated the selection — silently overwriting where the step had
 * just landed. Here that shows up as skipping the whole Tesla block.
 */
describe("selection committed on Next", () => {
  const FLOW: StepDef[] = [
    {
      id: "vehicle-type",
      label: "Vehicle Type",
      useStep: () => ({
        next: {
          kind: "ready",
          hint: null,
          // The re-opened-wizard case: the card reads as selected from an
          // existing vehicle while the wizard has no type recorded.
          onNext: () => Promise.resolve({ vehicleType: "tesla" }),
        },
        view: <div>vehicle-type</div>,
      }),
    },
    {
      id: "tesla-step",
      label: "Tesla",
      owner: "tesla",
      useStep: () => ({
        next: { kind: "hidden" },
        view: <div>tesla-step</div>,
      }),
    },
    {
      id: "inverter-type",
      label: "Inverter Type",
      useStep: () => ({
        next: { kind: "hidden" },
        view: <div>inverter-type</div>,
      }),
    },
  ];

  it("enters the plugin block rather than skipping past it", async () => {
    let state: WizardNavState = {
      stepId: "vehicle-type",
      vehicleType: "",
      energyType: "",
    };
    const patch = vi.fn((next: Partial<WizardNavState>) => {
      state = { ...state, ...next };
      rerender(<Harness />);
    });
    const store = {
      get state() {
        return state;
      },
      patch,
      isLoading: false,
    } as unknown as WizardStore;

    function Harness() {
      return <WizardShell flow={FLOW} store={store} basePath="/x" />;
    }
    const { rerender } = render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    // The move runs after the step's Next handler resolves, so let the
    // microtask that carries it run before asserting.
    await new Promise((r) => setTimeout(r, 0));

    // One move, carrying the selection and the step it leads to together.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({
      vehicleType: "tesla",
      stepId: "tesla-step",
    });
    expect(state.stepId).toBe("tesla-step");
  });

  it("saves the selection and finishes when the selecting step is last", async () => {
    // The end of the flow used to write the current step onto itself, so a
    // selection step in last position applied nothing and went nowhere — no
    // completion, no error, no movement.
    const onlyStep: StepDef[] = [
      {
        id: "vehicle-type",
        label: "Vehicle Type",
        useStep: () => ({
          next: {
            kind: "ready",
            hint: null,
            onNext: () => Promise.resolve({ vehicleType: "tesla" }),
          },
          view: <div>vehicle-type</div>,
        }),
      },
    ];
    let state: WizardNavState = {
      stepId: "vehicle-type",
      vehicleType: "",
      energyType: "",
    };
    const patch = vi.fn((next: Partial<WizardNavState>) => {
      state = { ...state, ...next };
    });
    const onComplete = vi.fn();
    const store = {
      get state() {
        return state;
      },
      patch,
      isLoading: false,
    } as unknown as WizardStore;

    render(
      <WizardShell
        flow={onlyStep}
        store={store}
        basePath="/x"
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
    await new Promise((r) => setTimeout(r, 0));

    expect(patch).toHaveBeenCalledWith({ vehicleType: "tesla" });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
