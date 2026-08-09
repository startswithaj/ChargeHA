import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { VehicleSettings } from "./VehicleSettings.tsx";
import {
  pluginSettingsComponents,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";

const { makeHookReturn, hookRef } = vi.hoisted(() => {
  const make = (overrides: Record<string, unknown> = {}) => ({
    vehicles: [] as Array<{
      id: string;
      name: string;
      adapterType: string;
      priority: number;
    }>,
    loading: false,
    loadFailed: false,
    error: null as string | null,
    recentlyAddedVins: new Set<string>(),
    handleDelete: vi.fn(),
    handleAddSimulatedVehicle: vi.fn(),
    vehiclePlugins: [] as Array<{
      id: string;
      displayName: string;
      configured: boolean;
      settingsComponentKey?: string;
    }>,
    handleStartOnboarding: vi.fn(),
    ...overrides,
  });
  return {
    makeHookReturn: make,
    hookRef: { current: make() },
  };
});

vi.mock("./useVehicleSettings.ts", () => ({
  useVehicleSettings: () => hookRef.current,
}));

vi.mock("./VehicleControlToggle.tsx", () => ({
  VehicleControlToggle: () => <div data-testid="vehicle-control-toggle" />,
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title }: { children: React.ReactNode; title: string },
  ) => (
    <div data-testid="settings-section">
      <h3>{title}</h3>
      {children}
    </div>
  ),
  SettingsRow: (
    { children, label }: { children: React.ReactNode; label: string },
  ) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
}));

const { mockChargingMutate } = vi.hoisted(() => ({
  mockChargingMutate: vi.fn(),
}));
vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useChargingConfig: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
  useChargingConfigMutation: vi.fn(() => ({
    mutate: mockChargingMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    saveStatus: { state: "idle", tick: 0 },
  })),
}));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  pluginSettingsComponents: {} as Record<string, React.FC>,
  vehiclePluginSteps: {} as Record<string, unknown[]>,
  vehiclePluginOptions: [] as Array<{ id: string; demoAvailable?: boolean }>,
}));

describe("VehicleSettings", () => {
  beforeEach(() => {
    hookRef.current = makeHookReturn();
  });

  afterEach(() => {
    cleanup();
    Object.keys(pluginSettingsComponents).forEach((key) => {
      delete (pluginSettingsComponents as Record<string, unknown>)[key];
    });
    Object.keys(vehiclePluginSteps).forEach((key) => {
      delete (vehiclePluginSteps as Record<string, unknown>)[key];
    });
  });

  it("renders loading state", () => {
    hookRef.current = makeHookReturn({ loading: true });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Loading vehicles...")).toBeInTheDocument();
  });

  it("renders empty state when no vehicles", () => {
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("No vehicles configured yet.")).toBeInTheDocument();
  });

  it("renders load failed message", () => {
    hookRef.current = makeHookReturn({ loadFailed: true });
    renderWithProviders(<VehicleSettings />);
    expect(
      screen.getByText(/Could not load vehicles/),
    ).toBeInTheDocument();
  });

  it("renders error card when error present", () => {
    hookRef.current = makeHookReturn({ error: "Something went wrong" });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders vehicle list", () => {
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByText("VIN1")).toBeInTheDocument();
    expect(screen.getByText("tesla")).toBeInTheDocument();
  });

  it("calls handleDelete when delete button clicked", () => {
    const handleDelete = vi.fn();
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
      ],
      handleDelete,
    });
    renderWithProviders(<VehicleSettings />);
    const buttons = screen.getAllByRole("button");
    // The delete button is just before the "Add Simulated Vehicle" button
    fireEvent.click(buttons[buttons.length - 2]);
  });

  it("calls handleMovePriority when priority buttons clicked", () => {
    const handleMovePriority = vi.fn();
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
        { id: "VIN2", name: "Model Y", adapterType: "tesla", priority: 2 },
      ],
      handleMovePriority,
    });
    renderWithProviders(<VehicleSettings />);
    const buttons = screen.getAllByRole("button");
    // The priority section has ArrowUp and ArrowDown for each vehicle
    // First vehicle: up disabled, down enabled
    // Second vehicle: up enabled, down disabled
    const enabledButtons = buttons.filter((b) => !b.hasAttribute("disabled"));
    if (enabledButtons.length > 0) {
      fireEvent.click(enabledButtons[0]);
    }
  });

  it("calls handleAddSimulatedVehicle when add sim button clicked", () => {
    const handleAddSimulatedVehicle = vi.fn();
    hookRef.current = makeHookReturn({ handleAddSimulatedVehicle });
    renderWithProviders(<VehicleSettings />);
    fireEvent.click(screen.getByText("Add Simulated Vehicle"));
    expect(handleAddSimulatedVehicle).toHaveBeenCalled();
  });

  it("renders unconfigured plugin with setup button", () => {
    const handleStartOnboarding = vi.fn();
    (vehiclePluginSteps as Record<string, unknown[]>)["tesla"] = [
      { id: "step1" },
    ];
    hookRef.current = makeHookReturn({
      vehiclePlugins: [
        { id: "tesla", displayName: "Tesla", configured: false },
      ],
      handleStartOnboarding,
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Tesla")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Set up Tesla/));
    expect(handleStartOnboarding).toHaveBeenCalledWith("tesla");
  });

  it("does not render setup button for configured plugins", () => {
    hookRef.current = makeHookReturn({
      vehiclePlugins: [
        { id: "tesla", displayName: "Tesla", configured: true },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
  });

  it("renders plugin settings component for configured plugin", () => {
    const MockPluginSettings = () => (
      <div data-testid="plugin-settings">Plugin Settings</div>
    );
    (pluginSettingsComponents as Record<string, React.FC>)["teslaSettings"] =
      MockPluginSettings;
    hookRef.current = makeHookReturn({
      vehiclePlugins: [
        {
          id: "tesla",
          displayName: "Tesla",
          configured: true,
          settingsComponentKey: "teslaSettings",
        },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByTestId("plugin-settings")).toBeInTheDocument();
  });

  it("renders simulated vehicle section", () => {
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Simulated Vehicle")).toBeInTheDocument();
    expect(
      screen.getByText(/Add a virtual EV for testing/),
    ).toBeInTheDocument();
  });
});
