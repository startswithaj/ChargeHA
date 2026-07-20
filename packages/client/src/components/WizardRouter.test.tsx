import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { StepDef, WizardStore } from "./Wizard/flow.ts";

const mocks = vi.hoisted(() => ({
  stub: { next: { kind: "hidden" as const }, view: null },
  patch: vi.fn(),
}));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  vehiclePluginOptions: [],
  energyPluginOptions: [],
  vehiclePluginSteps: {
    tesla: [
      {
        id: "tesla-key-gen",
        label: "Key Generation",
        useStep: () => mocks.stub,
      },
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
  },
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
    state: {
      stepId: "welcome",
      vehicleType: "tesla",
      energyType: "fronius_local",
    },
    patch: mocks.patch,
    isLoading: false,
  })),
}));

vi.mock("./Wizard/WizardShell.tsx", () => ({
  WizardShell: (
    { flow, store, basePath, onComplete, onExit }: {
      flow: StepDef[];
      store: WizardStore;
      basePath: string;
      onComplete: () => void;
      onExit?: () => void;
    },
  ) => (
    <div>
      <div data-testid="base-path">{basePath}</div>
      <div data-testid="step-id">{store.state.stepId}</div>
      <div data-testid="vehicle-type">{store.state.vehicleType}</div>
      <div data-testid="energy-type">{store.state.energyType}</div>
      <div data-testid="flow-length">{flow.length}</div>
      <button type="button" onClick={() => store.patch({ stepId: "timezone" })}>
        Patch
      </button>
      <button type="button" onClick={onComplete}>Complete</button>
      {onExit && <button type="button" onClick={onExit}>Exit</button>}
    </div>
  ),
}));

import { WizardRouter } from "./WizardRouter.tsx";

describe("WizardRouter", () => {
  it("passes the whole flow to the shell, gating rather than composing", () => {
    render(<WizardRouter onComplete={vi.fn()} />);

    // 8 core steps + 1 tesla + 1 fronius; the shell gets every step and gates via `when`.
    expect(screen.getByTestId("flow-length")).toHaveTextContent("10");
  });

  it("passes the wizard state through as the shell's store", () => {
    render(<WizardRouter onComplete={vi.fn()} />);

    expect(screen.getByTestId("step-id")).toHaveTextContent("welcome");
    expect(screen.getByTestId("vehicle-type")).toHaveTextContent("tesla");
    expect(screen.getByTestId("energy-type")).toHaveTextContent(
      "fronius_local",
    );
  });

  it("addresses steps under /wizard", () => {
    render(<WizardRouter onComplete={vi.fn()} />);

    expect(screen.getByTestId("base-path")).toHaveTextContent("/wizard");
  });

  it("persists store patches through the wizard state hook", async () => {
    render(<WizardRouter onComplete={vi.fn()} />);

    await userEvent.click(screen.getByText("Patch"));

    expect(mocks.patch).toHaveBeenCalledWith({ stepId: "timezone" });
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
