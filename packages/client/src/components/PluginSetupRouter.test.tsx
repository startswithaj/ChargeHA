import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  invalidateVehicleList: vi.fn(),
  invalidateVehiclePlugins: vi.fn(),
  invalidateEnergyPlugins: vi.fn(),
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
  vehiclePluginOptions: [
    { id: "tesla", label: "Tesla", description: "Tesla", iconKey: "car" },
    {
      id: "simulated",
      label: "Simulated",
      description: "Sim",
      iconKey: "monitor",
    },
  ],
  energyPluginOptions: [
    {
      id: "fronius_local",
      label: "Fronius Local",
      description: "Fronius",
      iconKey: "server",
    },
  ],
  vehiclePluginSteps: {
    tesla: [
      {
        id: "tesla-key-gen",
        label: "Key Generation",
        componentKey: "tesla-key-generation",
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
}));

// Mock PluginOnboardingWizard to capture props
vi.mock(
  "./PluginOnboardingWizard/PluginOnboardingWizard.tsx",
  () => ({
    PluginOnboardingWizard: (
      { pluginId, pluginName, steps, onComplete, onCancel }: {
        pluginId: string;
        pluginName: string;
        steps: Array<{ id: string }>;
        onComplete: () => void;
        onCancel: () => void;
      },
    ) => (
      <div>
        <span data-testid="plugin-id">{pluginId}</span>
        <span data-testid="plugin-name">{pluginName}</span>
        <span data-testid="step-count">{steps.length}</span>
        <button type="button" onClick={onComplete}>Complete</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    ),
  }),
);

import { PluginSetupRouter } from "./PluginSetupRouter.tsx";
import type { Route } from "../hooks/useRouter.ts";

describe("PluginSetupRouter", () => {
  const mockNavigate = vi.fn<(route: Route) => void>();

  beforeEach(() => {
    mocks.invalidateVehicleList.mockClear();
    mocks.invalidateVehiclePlugins.mockClear();
    mocks.invalidateEnergyPlugins.mockClear();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("vehicle plugin", () => {
    it("renders with correct plugin name and step count from registry", () => {
      render(
        <PluginSetupRouter pluginId="tesla" navigate={mockNavigate} />,
      );

      expect(screen.getByTestId("plugin-name")).toHaveTextContent("Tesla");
      expect(screen.getByTestId("plugin-id")).toHaveTextContent("tesla");
      expect(screen.getByTestId("step-count")).toHaveTextContent("1");
    });

    it("invalidates vehicle caches and navigates to settings on complete", async () => {
      render(
        <PluginSetupRouter pluginId="tesla" navigate={mockNavigate} />,
      );

      await userEvent.click(screen.getByText("Complete"));

      expect(mocks.invalidateVehicleList).toHaveBeenCalled();
      expect(mocks.invalidateVehiclePlugins).toHaveBeenCalled();
      expect(mocks.invalidateEnergyPlugins).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith({
        type: "app",
        page: "settings",
      });
    });
  });

  describe("energy plugin", () => {
    it("renders with correct plugin name and step count from registry", () => {
      render(
        <PluginSetupRouter
          pluginId="fronius_local"
          navigate={mockNavigate}
        />,
      );

      expect(screen.getByTestId("plugin-name")).toHaveTextContent(
        "Fronius Local",
      );
      expect(screen.getByTestId("plugin-id")).toHaveTextContent(
        "fronius_local",
      );
      expect(screen.getByTestId("step-count")).toHaveTextContent("1");
    });

    it("invalidates energy caches and navigates to settings on complete", async () => {
      render(
        <PluginSetupRouter
          pluginId="fronius_local"
          navigate={mockNavigate}
        />,
      );

      await userEvent.click(screen.getByText("Complete"));

      expect(mocks.invalidateEnergyPlugins).toHaveBeenCalled();
      expect(mocks.invalidateVehicleList).not.toHaveBeenCalled();
      expect(mocks.invalidateVehiclePlugins).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith({
        type: "app",
        page: "settings",
      });
    });
  });

  describe("cancel", () => {
    it("navigates to settings on cancel", async () => {
      render(
        <PluginSetupRouter pluginId="tesla" navigate={mockNavigate} />,
      );

      await userEvent.click(screen.getByText("Cancel"));

      expect(mockNavigate).toHaveBeenCalledWith({
        type: "app",
        page: "settings",
      });
    });
  });

  describe("unknown plugin", () => {
    it("falls back to pluginId as name when not in registry", () => {
      render(
        <PluginSetupRouter
          pluginId="unknown_plugin"
          navigate={mockNavigate}
        />,
      );

      expect(screen.getByTestId("plugin-name")).toHaveTextContent(
        "unknown_plugin",
      );
    });

    it("renders empty steps for unknown plugin", () => {
      render(
        <PluginSetupRouter
          pluginId="unknown_plugin"
          navigate={mockNavigate}
        />,
      );

      expect(screen.getByTestId("step-count")).toHaveTextContent("0");
    });

    it("treats unknown plugin as energy and invalidates energy caches", async () => {
      render(
        <PluginSetupRouter
          pluginId="unknown_plugin"
          navigate={mockNavigate}
        />,
      );

      await userEvent.click(screen.getByText("Complete"));

      // unknown_plugin is not in vehiclePluginSteps, so isVehiclePlugin is false
      expect(mocks.invalidateEnergyPlugins).toHaveBeenCalled();
      expect(mocks.invalidateVehicleList).not.toHaveBeenCalled();
      expect(mocks.invalidateVehiclePlugins).not.toHaveBeenCalled();
    });
  });

  describe("simulated vehicle plugin", () => {
    it("uses simulated vehicle steps (empty array)", () => {
      render(
        <PluginSetupRouter
          pluginId="simulated"
          navigate={mockNavigate}
        />,
      );

      expect(screen.getByTestId("plugin-name")).toHaveTextContent("Simulated");
      expect(screen.getByTestId("step-count")).toHaveTextContent("0");
    });

    it("invalidates vehicle caches on complete (simulated is a vehicle plugin)", async () => {
      render(
        <PluginSetupRouter
          pluginId="simulated"
          navigate={mockNavigate}
        />,
      );

      await userEvent.click(screen.getByText("Complete"));

      expect(mocks.invalidateVehicleList).toHaveBeenCalled();
      expect(mocks.invalidateVehiclePlugins).toHaveBeenCalled();
    });
  });
});
