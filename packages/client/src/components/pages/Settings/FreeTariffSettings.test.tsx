import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { FreeTariffSettings } from "./FreeTariffSettings.tsx";

const { mockChargingMutate, state } = vi.hoisted(() => ({
  mockChargingMutate: vi.fn(),
  state: {
    chargingConfigData: null as Record<string, unknown> | null,
    currentRateData: null as Record<string, unknown> | null,
  },
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useChargingConfig: () => ({ data: state.chargingConfigData }),
  useChargingConfigMutation: () => ({
    mutate: mockChargingMutate,
    saveStatus: { state: "idle", tick: 0 },
  }),
}));

vi.mock("../../../trpc.ts", () => ({
  trpc: {
    tariff: {
      currentRate: { useQuery: () => ({ data: state.currentRateData }) },
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
      {action && <div data-testid="action">{action}</div>}
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
    { value, suffix }: { value: string; suffix: string },
  ) => <span data-testid="number-input">{value}{suffix}</span>,
}));

describe("FreeTariffSettings", () => {
  beforeEach(() => {
    state.chargingConfigData = {
      chargingEnabled: true,
      priorityChargingEnabled: false,
      freeTariffChargingEnabled: false,
      freeTariffMaxRatePerKwh: 0,
    };
    state.currentRateData = null;
    mockChargingMutate.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null when config not loaded", () => {
    state.chargingConfigData = null;
    renderWithProviders(<FreeTariffSettings />);
    expect(screen.queryByText("Free Grid Charging")).not.toBeInTheDocument();
  });

  it("renders the section title and both rows", () => {
    renderWithProviders(<FreeTariffSettings />);
    expect(screen.getByText("Free Grid Charging")).toBeInTheDocument();
    expect(screen.getByText("Charge when grid is free")).toBeInTheDocument();
    expect(screen.getByText("Treat as free at or below")).toBeInTheDocument();
  });

  it("shows the configured threshold", () => {
    state.chargingConfigData = {
      freeTariffChargingEnabled: true,
      freeTariffMaxRatePerKwh: 0.12,
    };
    renderWithProviders(<FreeTariffSettings />);
    expect(screen.getByTestId("number-input")).toHaveTextContent("0.12/kWh");
  });

  it("says no tariff is configured when the rate can't be resolved", () => {
    renderWithProviders(<FreeTariffSettings />);
    expect(screen.getByText("No tariff configured")).toBeInTheDocument();
  });

  it("shows a free badge when the rate is at or below the threshold", () => {
    state.chargingConfigData = {
      freeTariffChargingEnabled: true,
      freeTariffMaxRatePerKwh: 0,
    };
    state.currentRateData = {
      ratePerKwh: 0,
      label: "Free",
      currencySymbol: "$",
    };
    renderWithProviders(<FreeTariffSettings />);
    expect(screen.getByText(/Free now/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\/kWh/)).toBeInTheDocument();
  });

  it("shows the plain rate when the tariff is not free", () => {
    state.chargingConfigData = {
      freeTariffChargingEnabled: true,
      freeTariffMaxRatePerKwh: 0,
    };
    state.currentRateData = {
      ratePerKwh: 0.45,
      label: "Peak",
      currencySymbol: "$",
    };
    renderWithProviders(<FreeTariffSettings />);
    expect(screen.queryByText(/Free now/)).not.toBeInTheDocument();
    expect(screen.getByText(/Peak/)).toBeInTheDocument();
  });

  it("does not claim free while the feature is disabled", () => {
    state.currentRateData = {
      ratePerKwh: 0,
      label: "Free",
      currencySymbol: "$",
    };
    renderWithProviders(<FreeTariffSettings />);
    expect(screen.queryByText(/Free now/)).not.toBeInTheDocument();
  });
});
