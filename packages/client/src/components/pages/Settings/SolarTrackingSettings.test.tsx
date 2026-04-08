import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { SolarTrackingSettings } from "./SolarTrackingSettings.tsx";

// Radix Slider/Select use ResizeObserver which jsdom doesn't provide
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = vi.fn();

const { mockSolarMutate, st } = vi.hoisted(() => ({
  mockSolarMutate: vi.fn(),
  st: {
    solarConfigData: null as Record<string, unknown> | null,
    batteryConfigData: null as Record<string, unknown> | null,
    energyData: undefined as
      | { realtime: Record<string, unknown> | null }
      | undefined,
    vehiclesData: undefined as
      | { vehicles: Array<{ id: string; name: string }> }
      | undefined,
  },
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useSolarConfig: () => ({ data: st.solarConfigData }),
  useBatteryConfig: () => ({ data: st.batteryConfigData }),
  useSolarConfigMutation: () => ({
    mutate: mockSolarMutate,
    saveStatus: { state: "idle", tick: 0 },
  }),
}));

vi.mock("../../../hooks/useEnergyData.ts", () => ({
  useEnergyData: () => ({ data: st.energyData }),
}));

vi.mock("../../../hooks/useSchedules.ts", () => ({
  useSchedules: () => ({ schedules: [] }),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: st.vehiclesData,
        })),
      },
    },
  },
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title, action }: {
      children: React.ReactNode;
      title: string;
      action?: React.ReactNode;
    },
  ) => (
    <div data-testid="settings-section">
      <h3>{title}</h3>
      {action && <div data-testid="section-action">{action}</div>}
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
  NumberInput: (
    { value, onChange, suffix }: {
      value: string;
      onChange: (v: string) => void;
      suffix: string;
    },
  ) => (
    <div>
      <input
        data-testid={`number-input-${suffix}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span>{suffix}</span>
    </div>
  ),
}));

vi.mock("../../SolarSimulation/SolarSimulation.tsx", () => ({
  SolarSimulation: () => <div data-testid="solar-simulation" />,
}));

describe("SolarTrackingSettings", () => {
  const defaultSolarConfig = () => ({
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only",
    solarReference: "excess",
    solarMarginKw: 0.5,
    minSolarGenerationKw: 0.2,
    minExcessSolarKw: null as number | null,
    gracePeriodMinutes: 6,
    cooldownPeriodMinutes: 15,
    ampDebounceThreshold: 2,
    ampDebounceSettleMinutes: 3,
    gridVoltage: 230,
    threePhaseCharger: false,
    consumptionExcludesCharging: false,
  });

  beforeEach(() => {
    st.solarConfigData = defaultSolarConfig();
    st.batteryConfigData = {
      batteryPriorityEnabled: false,
      batteryPriorityLimit: 80,
    };
    st.energyData = undefined;
    st.vehiclesData = undefined;
    mockSolarMutate.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null when config not loaded", () => {
    st.solarConfigData = null;
    renderWithProviders(<SolarTrackingSettings />);
    expect(screen.queryByText("Solar Tracking")).not.toBeInTheDocument();
  });

  it("renders section title", () => {
    renderWithProviders(<SolarTrackingSettings />);
    expect(screen.getByText("Solar Tracking")).toBeInTheDocument();
  });

  it.each([
    "Solar tracking enabled",
    "Mode",
    "Reference",
    "Solar margin",
    "Min solar generation",
    "Min excess solar",
    "Grace period",
    "Cooldown period",
    "Grid voltage",
    "Three-phase charger",
    "Consumption excludes charging",
    "Simulate",
  ])("renders %s control", (label) => {
    renderWithProviders(<SolarTrackingSettings />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders solar margin value", () => {
    renderWithProviders(<SolarTrackingSettings />);
    expect(screen.getByText("0.5 kW")).toBeInTheDocument();
  });

  it("shows simulation when simulate button clicked", () => {
    renderWithProviders(<SolarTrackingSettings />);
    expect(screen.queryByTestId("solar-simulation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Simulate"));
    expect(screen.getByTestId("solar-simulation")).toBeInTheDocument();
  });

  it("hides simulation on second click", () => {
    renderWithProviders(<SolarTrackingSettings />);
    fireEvent.click(screen.getByText("Simulate"));
    expect(screen.getByTestId("solar-simulation")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Simulate"));
    expect(screen.queryByTestId("solar-simulation")).not.toBeInTheDocument();
  });

  it("hides debounce fields until Advanced is toggled", () => {
    renderWithProviders(<SolarTrackingSettings />);
    expect(screen.queryByText("Amp change threshold")).not.toBeInTheDocument();
    expect(screen.queryByText("Amp settle time")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));

    expect(screen.getByText("Amp change threshold")).toBeInTheDocument();
    expect(screen.getByText("Amp settle time")).toBeInTheDocument();
  });
});
