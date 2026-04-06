import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { GeneralSettings } from "./GeneralSettings.tsx";

const { mockMutate, state } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  state: {
    systemConfig: null as unknown,
    homeConfig: null as unknown,
    saveStatus: { state: "idle" as const, tick: 0 } as {
      state: "idle" | "saving" | "saved";
      tick: number;
    },
  },
}));

// Polyfill for Radix Select
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = vi.fn();
}

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useSystemConfig: vi.fn(() => ({ data: state.systemConfig })),
  useHomeConfig: vi.fn(() => ({ data: state.homeConfig })),
  useSystemConfigMutation: vi.fn(() => ({
    mutate: mockMutate,
    saveStatus: state.saveStatus,
  })),
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: vi.fn(
    ({
      title,
      children,
      isDirty,
      onSave,
    }: {
      title: string;
      children: ReactNode;
      isDirty?: boolean;
      onSave?: () => void;
    }) => (
      <div data-testid={`section-${title}`}>
        <div>{title}</div>
        {isDirty && onSave && (
          <button type="button" onClick={onSave}>Save</button>
        )}
        {children}
      </div>
    ),
  ),
  SettingsRow: vi.fn(
    ({
      label,
      help,
      children,
    }: {
      label: string;
      help?: string;
      children: ReactNode;
    }) => (
      <div data-testid={`row-${label}`}>
        <span>{label}</span>
        {help && <span data-testid={`help-${label}`}>{help}</span>}
        {children}
      </div>
    ),
  ),
  NumberInput: vi.fn(
    ({
      value,
      onChange,
      suffix,
    }: {
      value: string;
      onChange: (v: string) => void;
      suffix: string;
    }) => (
      <div data-testid={`number-input-${suffix}`}>
        <input
          data-testid={`input-${suffix}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{suffix}</span>
      </div>
    ),
  ),
}));

vi.mock("./HomeLocationSection.tsx", () => ({
  HomeLocationSection: vi.fn(
    ({ homeConfig }: { homeConfig: unknown }) => (
      <div data-testid="home-location-section">
        {homeConfig ? "has-config" : "no-config"}
      </div>
    ),
  ),
}));

// ── Tests ──

describe("GeneralSettings", () => {
  // Intl.supportedValuesOf("timeZone") returns ~400+ entries, which Radix
  // Select renders as hidden options. Stub with a short list.
  const originalSupportedValuesOf = Intl.supportedValuesOf;

  beforeAll(() => {
    Intl.supportedValuesOf = ((key: string) => {
      if (key === "timeZone") {
        return ["UTC", "Australia/Melbourne", "America/New_York"];
      }
      return originalSupportedValuesOf(
        key as Parameters<typeof originalSupportedValuesOf>[0],
      );
    }) as typeof Intl.supportedValuesOf;
  });

  beforeEach(() => {
    mockMutate.mockReset();
    state.saveStatus = { state: "idle", tick: 0 };
    state.systemConfig = {
      controllerLoopSeconds: 10,
      recordingIntervalSeconds: 60,
      dataRetentionDays: 730,
      logRetentionDays: 30,
      timezone: "Australia/Melbourne",
    };
    state.homeConfig = {
      homeLatitude: -37.8136,
      homeLongitude: 144.9631,
    };
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    Intl.supportedValuesOf = originalSupportedValuesOf;
  });

  it("returns null when config is not loaded", () => {
    state.systemConfig = null;
    const { container } = renderWithProviders(<GeneralSettings />);
    // Section should not render
    expect(
      screen.queryByText("System"),
    ).not.toBeInTheDocument();
    // Home location section should not render either
    expect(
      screen.queryByTestId("home-location-section"),
    ).not.toBeInTheDocument();
    // container should be effectively empty (just Theme wrapper)
    expect(container.querySelector("[data-testid='section-System']"))
      .toBeNull();
  });

  it("renders System section when config is loaded", () => {
    renderWithProviders(<GeneralSettings />);
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it.each([
    "Controller loop interval",
    "Recording interval",
    "Data retention",
    "Log retention",
    "Timezone",
  ])("renders %s row with help text", (label) => {
    renderWithProviders(<GeneralSettings />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTestId(`help-${label}`)).toBeInTheDocument();
  });

  it("passes controllerLoopSeconds value to NumberInput", () => {
    renderWithProviders(<GeneralSettings />);
    const inputs = screen.getAllByTestId("input-sec");
    expect((inputs[0] as HTMLInputElement).value).toBe("10");
  });

  it.each<[string, "sec" | "days", 0 | 1, string, number]>([
    ["controllerLoopSeconds", "sec", 0, "30", 30],
    ["recordingIntervalSeconds", "sec", 1, "120", 120],
    ["dataRetentionDays", "days", 0, "365", 365],
    ["logRetentionDays", "days", 1, "14", 14],
  ])("mutates %s on change", (field, suffix, idx, value, expected) => {
    renderWithProviders(<GeneralSettings />);
    const inputs = screen.getAllByTestId(`input-${suffix}`);
    fireEvent.change(inputs[idx], { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mockMutate).toHaveBeenCalledWith({ [field]: expected });
  });

  it.each<[string, "sec" | "days", 0 | 1, number]>([
    ["controllerLoopSeconds", "sec", 0, 10],
    ["recordingIntervalSeconds", "sec", 1, 60],
    ["dataRetentionDays", "days", 0, 730],
    ["logRetentionDays", "days", 1, 30],
  ])(
    "falls back to default %s when parseInt returns NaN",
    (field, suffix, idx, fallback) => {
      renderWithProviders(<GeneralSettings />);
      const inputs = screen.getAllByTestId(`input-${suffix}`);
      fireEvent.change(inputs[idx], { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      expect(mockMutate).toHaveBeenCalledWith({ [field]: fallback });
    },
  );

  it("renders HomeLocationSection with homeConfig", () => {
    renderWithProviders(<GeneralSettings />);
    const section = screen.getByTestId("home-location-section");
    expect(section).toHaveTextContent("has-config");
  });

  it("renders HomeLocationSection with null when homeConfig is undefined", () => {
    state.homeConfig = undefined;
    renderWithProviders(<GeneralSettings />);
    const section = screen.getByTestId("home-location-section");
    expect(section).toHaveTextContent("no-config");
  });
});
