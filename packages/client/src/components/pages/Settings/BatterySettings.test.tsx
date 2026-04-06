import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { BatterySettings } from "./BatterySettings.tsx";

// Radix Slider uses ResizeObserver which jsdom doesn't provide
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { mockBatteryMutate, state } = vi.hoisted(() => ({
  mockBatteryMutate: vi.fn(),
  state: {
    batteryConfigData: null as Record<string, unknown> | null,
    energyData: undefined as
      | { realtime: Record<string, unknown> | null }
      | undefined,
  },
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useBatteryConfig: () => ({ data: state.batteryConfigData }),
  useBatteryConfigMutation: () => ({
    mutate: mockBatteryMutate,
    saveStatus: { state: "idle", tick: 0 },
  }),
}));

vi.mock("../../../hooks/useEnergyData.ts", () => ({
  useEnergyData: () => ({ data: state.energyData }),
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    {
      children,
      title,
      badge,
      action,
    }: {
      children: React.ReactNode;
      title: string;
      badge?: string;
      action?: React.ReactNode;
    },
  ) => (
    <div data-testid="settings-section">
      <h3>{title}</h3>
      {badge && <span data-testid="badge">{badge}</span>}
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
}));

describe("BatterySettings", () => {
  beforeEach(() => {
    state.batteryConfigData = {
      batteryPriorityEnabled: false,
      batteryPriorityLimit: 80,
    };
    state.energyData = undefined;
    mockBatteryMutate.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null when config not loaded", () => {
    state.batteryConfigData = null;
    renderWithProviders(<BatterySettings />);
    expect(screen.queryByText("Battery")).not.toBeInTheDocument();
  });

  it("renders section title", () => {
    renderWithProviders(<BatterySettings />);
    expect(screen.getByText("Battery")).toBeInTheDocument();
  });

  it("renders Beta badge", () => {
    renderWithProviders(<BatterySettings />);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders battery priority enabled switch", () => {
    renderWithProviders(<BatterySettings />);
    expect(
      screen.getByText("Battery priority enabled"),
    ).toBeInTheDocument();
  });

  it.each([
    ["80% when limit is 80", 80, false],
    ["90% when limit is 90", 90, true],
  ])(
    "renders battery priority limit slider showing %s",
    (_label, limit, enabled) => {
      state.batteryConfigData = {
        batteryPriorityEnabled: enabled,
        batteryPriorityLimit: limit,
      };
      renderWithProviders(<BatterySettings />);
      expect(screen.getByText("Battery priority limit")).toBeInTheDocument();
      expect(screen.getByText(`${limit}%`)).toBeInTheDocument();
    },
  );

  it("shows detected badge with SOC when battery is reporting", () => {
    state.energyData = {
      realtime: { batterySoc: 75.4 },
    };
    renderWithProviders(<BatterySettings />);
    expect(screen.queryByText("Not detected")).not.toBeInTheDocument();
    // Math.round(75.4) = 75
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  it.each<
    [string, undefined | { realtime: Record<string, unknown> | null }]
  >([
    ["no battery data", undefined],
    ["realtime is null", { realtime: null }],
    ["batterySoc is null", { realtime: { batterySoc: null } }],
  ])("shows Not detected when %s", (_label, energy) => {
    state.energyData = energy;
    renderWithProviders(<BatterySettings />);
    expect(screen.getByText("Not detected")).toBeInTheDocument();
  });
});
