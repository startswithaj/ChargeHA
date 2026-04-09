import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { InverterSettings } from "./InverterSettings.tsx";
import {
  energyPluginSteps,
  pluginSettingsComponents,
} from "@chargeha/plugins/componentRegistry";

// Radix Select uses ScrollArea which requires ResizeObserver
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = vi.fn();

const { mockEquipmentMutate, st } = vi.hoisted(() => ({
  mockEquipmentMutate: vi.fn(),
  st: {
    equipmentConfigData: null as Record<string, unknown> | null,
    pluginsData: null as
      | Array<{
        id: string;
        displayName: string;
        vendor: string;
        configured: boolean;
        settingsComponentKey?: string;
      }>
      | null,
  },
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useEquipmentConfig: () => ({ data: st.equipmentConfigData }),
  useEquipmentConfigMutation: () => ({
    mutate: mockEquipmentMutate,
    saveStatus: { state: "idle", tick: 0 },
  }),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    energy: {
      getPlugins: {
        useQuery: vi.fn(() => ({
          data: st.pluginsData,
        })),
      },
    },
  },
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

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  energyPluginSteps: {} as Record<string, unknown[]>,
  pluginSettingsComponents: {} as Record<string, React.FC>,
}));

describe("InverterSettings", () => {
  beforeEach(() => {
    st.equipmentConfigData = {
      energyAdapterType: "",
    };
    st.pluginsData = null;
  });

  afterEach(() => {
    cleanup();
    Object.keys(pluginSettingsComponents).forEach((key) => {
      delete (pluginSettingsComponents as Record<string, unknown>)[key];
    });
    Object.keys(energyPluginSteps).forEach((key) => {
      delete (energyPluginSteps as Record<string, unknown>)[key];
    });
  });

  it("returns null when config not loaded", () => {
    st.equipmentConfigData = null;
    renderWithProviders(<InverterSettings />);
    expect(screen.queryByText("My Equipment")).not.toBeInTheDocument();
  });

  it("renders section title", () => {
    renderWithProviders(<InverterSettings />);
    expect(screen.getByText("My Equipment")).toBeInTheDocument();
  });

  it("shows unconfigured message when no adapter selected", () => {
    renderWithProviders(<InverterSettings />);
    expect(
      screen.getByText(/Select your inverter or smart meter/),
    ).toBeInTheDocument();
  });

  it("hides unconfigured message when adapter is selected", () => {
    st.equipmentConfigData = { energyAdapterType: "fronius-local" };
    st.pluginsData = [
      {
        id: "fronius-local",
        displayName: "Fronius Local",
        vendor: "Fronius",
        configured: true,
      },
    ];
    renderWithProviders(<InverterSettings />);
    expect(
      screen.queryByText(/Select your inverter or smart meter/),
    ).not.toBeInTheDocument();
  });

  it("renders plugin settings component for configured adapter", () => {
    const MockSettings = () => (
      <div data-testid="energy-plugin-settings">Energy Settings</div>
    );
    (pluginSettingsComponents as Record<string, React.FC>)["froniusSettings"] =
      MockSettings;
    st.equipmentConfigData = { energyAdapterType: "fronius-local" };
    st.pluginsData = [
      {
        id: "fronius-local",
        displayName: "Fronius Local",
        vendor: "Fronius",
        configured: true,
        settingsComponentKey: "froniusSettings",
      },
    ];
    renderWithProviders(<InverterSettings />);
    expect(screen.getByTestId("energy-plugin-settings")).toBeInTheDocument();
  });

  it("does not render plugin settings when component not in registry", () => {
    st.equipmentConfigData = { energyAdapterType: "fronius-local" };
    st.pluginsData = [
      {
        id: "fronius-local",
        displayName: "Fronius Local",
        vendor: "Fronius",
        configured: true,
        settingsComponentKey: "nonexistent",
      },
    ];
    renderWithProviders(<InverterSettings />);
    expect(
      screen.queryByTestId("energy-plugin-settings"),
    ).not.toBeInTheDocument();
  });

  it("renders setup button for unconfigured plugin with wizard steps", () => {
    (energyPluginSteps as Record<string, unknown[]>)["fronius-local"] = [
      { id: "step1" },
    ];
    st.equipmentConfigData = { energyAdapterType: "fronius-local" };
    st.pluginsData = [
      {
        id: "fronius-local",
        displayName: "Fronius Local",
        vendor: "Fronius",
        configured: false,
      },
    ];
    renderWithProviders(<InverterSettings />);
    expect(screen.getByText(/Set up Fronius Local/)).toBeInTheDocument();
  });

  it("clicking setup button navigates to setup path", () => {
    (energyPluginSteps as Record<string, unknown[]>)["fronius-local"] = [
      { id: "step1" },
    ];
    st.equipmentConfigData = { energyAdapterType: "fronius-local" };
    st.pluginsData = [
      {
        id: "fronius-local",
        displayName: "Fronius Local",
        vendor: "Fronius",
        configured: false,
      },
    ];
    const pushStateSpy = vi.spyOn(globalThis.history, "pushState");
    renderWithProviders(<InverterSettings />);
    fireEvent.click(screen.getByText(/Set up Fronius Local/));
    expect(pushStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/setup/fronius-local",
    );
    pushStateSpy.mockRestore();
  });
});
