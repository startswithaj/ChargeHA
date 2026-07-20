import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { StepDef } from "./Wizard/flow.ts";
import type { WizardStore } from "./Wizard/flow.ts";

const mocks = vi.hoisted(() => ({
  invalidateVehicleList: vi.fn(),
  invalidateVehiclePlugins: vi.fn(),
  invalidateEnergyPlugins: vi.fn(),
  navigate: vi.fn(),
  patch: vi.fn(),
  clear: vi.fn(),
  stub: { next: { kind: "hidden" as const }, view: null },
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: vi.fn(() => ({
      vehicle: {
        list: { invalidate: mocks.invalidateVehicleList },
        getPlugins: { invalidate: mocks.invalidateVehiclePlugins },
      },
      energy: {
        getPlugins: { invalidate: mocks.invalidateEnergyPlugins },
      },
    })),
  },
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

vi.mock("../hooks/usePluginOnboardingState.ts", () => ({
  usePluginOnboardingState: vi.fn((
    pluginId: string,
    defaultStepId: string,
    kind: "vehicle" | "energy",
  ) => ({
    state: {
      stepId: defaultStepId,
      vehicleType: kind === "vehicle" ? pluginId : "",
      energyType: kind === "energy" ? pluginId : "",
    },
    patch: mocks.patch,
    isLoading: false,
    clear: mocks.clear,
  })),
}));

vi.mock("./Wizard/WizardShell.tsx", () => ({
  WizardShell: (
    { flow, store, basePath, onComplete, onBackOut }: {
      flow: StepDef[];
      store: WizardStore;
      basePath: string;
      onComplete: () => void;
      onBackOut?: () => void;
    },
  ) => (
    <div>
      <span data-testid="base-path">{basePath}</span>
      <span data-testid="step-count">{flow.length}</span>
      <span data-testid="step-id">{store.state.stepId}</span>
      <span data-testid="vehicle-type">{store.state.vehicleType}</span>
      <span data-testid="owners">
        {[...new Set(flow.map((s) => s.owner ?? "none"))].join(",")}
      </span>
      <button type="button" onClick={() => store.patch({ stepId: "next-one" })}>
        Patch
      </button>
      <button type="button" onClick={onComplete}>Complete</button>
      {onBackOut && <button type="button" onClick={onBackOut}>Cancel</button>}
    </div>
  ),
}));

vi.mock("../hooks/useRouter.ts", () => ({
  useRouter: () => ({
    route: { type: "app", page: "dashboard" },
    navigate: mocks.navigate,
  }),
}));

import { PluginSetupRouter } from "./PluginSetupRouter.tsx";

describe("PluginSetupRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("vehicle plugin", () => {
    it("renders the plugin's own steps, addressed under its setup path", () => {
      render(<PluginSetupRouter pluginId="tesla" />);

      expect(screen.getByTestId("step-count")).toHaveTextContent("1");
      expect(screen.getByTestId("base-path")).toHaveTextContent("/setup/tesla");
    });

    it("starts on the plugin's first step", () => {
      render(<PluginSetupRouter pluginId="tesla" />);

      expect(screen.getByTestId("step-id")).toHaveTextContent("tesla-key-gen");
    });

    it("invalidates vehicle caches and navigates to settings on complete", async () => {
      render(<PluginSetupRouter pluginId="tesla" />);

      await userEvent.click(screen.getByText("Complete"));

      expect(mocks.invalidateVehicleList).toHaveBeenCalled();
      expect(mocks.invalidateVehiclePlugins).toHaveBeenCalled();
      expect(mocks.invalidateEnergyPlugins).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith({
        type: "app",
        page: "settings",
      });
    });

    it("clears the stored onboarding step on complete so a re-run starts fresh", async () => {
      render(<PluginSetupRouter pluginId="tesla" />);

      await userEvent.click(screen.getByText("Complete"));

      expect(mocks.clear).toHaveBeenCalled();
    });
  });

  describe("energy plugin", () => {
    it("renders the plugin's own steps, addressed under its setup path", () => {
      render(<PluginSetupRouter pluginId="fronius_local" />);

      expect(screen.getByTestId("step-count")).toHaveTextContent("1");
      expect(screen.getByTestId("base-path")).toHaveTextContent(
        "/setup/fronius_local",
      );
    });

    it("invalidates energy caches and navigates to settings on complete", async () => {
      render(<PluginSetupRouter pluginId="fronius_local" />);

      await userEvent.click(screen.getByText("Complete"));

      expect(mocks.invalidateEnergyPlugins).toHaveBeenCalled();
      expect(mocks.invalidateVehicleList).not.toHaveBeenCalled();
      expect(mocks.invalidateVehiclePlugins).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith({
        type: "app",
        page: "settings",
      });
    });
  });

  describe("skip", () => {
    it("marks the plugin as the owner of its steps and as the selection", () => {
      render(<PluginSetupRouter pluginId="tesla" />);

      // Owner makes Skip abandon the whole chain; the selection keeps those steps in the list.
      expect(screen.getByTestId("owners")).toHaveTextContent("tesla");
      expect(screen.getByTestId("vehicle-type")).toHaveTextContent("tesla");
    });
  });

  describe("store", () => {
    it("persists step changes to the plugin's own onboarding state", async () => {
      render(<PluginSetupRouter pluginId="tesla" />);

      await userEvent.click(screen.getByText("Patch"));

      expect(mocks.patch).toHaveBeenCalledWith({ stepId: "next-one" });
    });
  });

  describe("cancel", () => {
    it("navigates to settings when backing out of the first step", async () => {
      render(<PluginSetupRouter pluginId="tesla" />);

      await userEvent.click(screen.getByText("Cancel"));

      expect(mocks.navigate).toHaveBeenCalledWith({
        type: "app",
        page: "settings",
      });
    });
  });

  describe("plugins with no setup steps", () => {
    it.each(["unknown_plugin", "simulated"])(
      "renders nothing for %s rather than an empty wizard",
      (pluginId) => {
        const { container } = render(<PluginSetupRouter pluginId={pluginId} />);

        expect(container).toBeEmptyDOMElement();
      },
    );
  });
});
