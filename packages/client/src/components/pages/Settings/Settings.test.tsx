import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import type { SectionProps, SettingsRowProps } from "./SettingsLayout.tsx";

vi.mock("../../../hooks/useEnergyData.ts", () => ({
  useEnergyData: () => ({ data: undefined }),
}));

vi.mock("../../../hooks/useSchedules.ts", () => ({
  useSchedules: () => ({ schedules: [] }),
}));

const { mockAc } = vi.hoisted(() => ({
  mockAc: {
    query: "",
    setQuery: vi.fn(),
    updateQuery: vi.fn(),
    suggestions: [] as Array<
      { display_name: string; lat: string; lon: string }
    >,
    open: false,
    setOpen: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAddressAutocomplete.ts", () => ({
  useAddressAutocomplete: () => mockAc,
}));

vi.mock("../../StaticMap/StaticMap.tsx", () => ({
  StaticMap: () => <div data-testid="static-map" />,
}));

vi.mock("../../SolarSimulation/SolarSimulation.tsx", () => ({
  SolarSimulation: () => <div data-testid="solar-simulation" />,
}));

vi.mock("./NotificationSettings.tsx", () => ({
  NotificationSettings: () => <div data-testid="notification-settings" />,
}));

vi.mock("./AuthSettings.tsx", () => ({
  AuthSettings: () => <div data-testid="auth-settings" />,
}));

vi.mock("./TariffSettings.tsx", () => ({
  TariffSettings: () => <div data-testid="tariff-settings" />,
}));

vi.mock("./VehicleSettings.tsx", () => ({
  VehicleSettings: () => <div data-testid="vehicle-settings" />,
}));

vi.mock("./SolarTrackingSettings.tsx", () => ({
  SolarTrackingSettings: () => <div data-testid="solar-tracking-settings" />,
}));

const {
  mockLocationFetch,
  mockSetBulkMutate,
  mockConfigGetAllUseQuery,
  mockInvalidateConfig,
  mockWizardStatusUseQuery,
  mockEncryptionHealthUseQuery,
} = vi.hoisted(() => ({
  mockLocationFetch: vi.fn().mockResolvedValue({
    latitude: -33.86882,
    longitude: 151.20929,
  }),
  mockSetBulkMutate: vi.fn(),
  mockConfigGetAllUseQuery: vi.fn((): {
    data: { chargingEnabled: boolean } | undefined;
    isLoading: boolean;
    error: Error | null;
  } => ({
    data: { chargingEnabled: true },
    isLoading: false,
    error: null,
  })),
  mockInvalidateConfig: vi.fn(),
  mockWizardStatusUseQuery: vi.fn(() => ({
    data: { completed: false, firstRun: false },
    isLoading: false,
    error: null,
  })),
  mockEncryptionHealthUseQuery: vi.fn(
    (): { data: { configured: boolean } | undefined } => ({
      data: { configured: true },
    }),
  ),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    config: {
      charging: {
        get: {
          useQuery: () => mockConfigGetAllUseQuery(),
        },
        set: {
          useMutation: vi.fn((_opts?: {
            onMutate?: () => void;
            onSuccess?: () => void;
            onError?: (err: unknown) => void;
          }) => {
            return {
              mutate: mockSetBulkMutate,
              mutateAsync: vi.fn(),
              isPending: false,
              isSuccess: false,
              isError: false,
              error: null,
              data: undefined,
              reset: vi.fn(),
            };
          }),
        },
      },
    },
    wizard: {
      status: {
        useQuery: () => mockWizardStatusUseQuery(),
      },
    },
    health: {
      encryption: {
        useQuery: () => mockEncryptionHealthUseQuery(),
      },
    },
    useUtils: vi.fn(() => ({
      config: {
        charging: {
          get: {
            invalidate: mockInvalidateConfig,
          },
        },
      },
      vehicle: {
        location: {
          fetch: mockLocationFetch,
        },
      },
    })),
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          error: null,
        })),
      },
    },
  },
}));

vi.mock("./BatterySettings.tsx", () => ({
  BatterySettings: () => <div data-testid="battery-settings" />,
}));

vi.mock("./InverterSettings.tsx", () => ({
  InverterSettings: () => <div data-testid="inverter-settings" />,
}));

vi.mock("./GeneralSettings.tsx", () => ({
  GeneralSettings: () => <div data-testid="general-settings" />,
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title, badge, action, isDirty, onSave }: SectionProps & {
      isDirty?: boolean;
      onSave?: () => void;
    },
  ) => (
    <div>
      <h3>{title}</h3>
      {badge && <span data-testid="section-badge">{badge}</span>}
      {isDirty && onSave && (
        <button type="button" onClick={onSave}>Save</button>
      )}
      {action && <div data-testid="section-action">{action}</div>}
      {children}
    </div>
  ),
  SettingsRow: ({ children, label, help }: SettingsRowProps) => (
    <div>
      <label>{label}</label>
      {help && <span data-testid="help-text">{help}</span>}
      {children}
    </div>
  ),
  NumberInput: (
    { value, onChange, suffix, step, min, max, placeholder }: {
      value: string;
      onChange: (v: string) => void;
      suffix: string;
      step?: number;
      min?: number;
      max?: number;
      placeholder?: string;
    },
  ) => (
    <div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
      />
      <span>{suffix}</span>
    </div>
  ),
}));

import { Settings } from "./Settings.tsx";

describe("Settings", () => {
  const defaultConfig = {
    chargingEnabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
    Element.prototype.scrollIntoView = vi.fn();

    // Reset mockAc to defaults
    mockAc.query = "";
    mockAc.suggestions = [];
    mockAc.open = false;
    mockAc.setQuery.mockClear();
    mockAc.updateQuery.mockClear();
    mockAc.setOpen.mockClear();
    mockAc.clear.mockClear();

    // Reset to defaults
    mockConfigGetAllUseQuery.mockReturnValue({
      data: { ...defaultConfig },
      isLoading: false,
      error: null,
    });
  });

  describe("per-section save", () => {
    it("calls charging mutation with toggled value when Save is clicked", async () => {
      renderWithProviders(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Charging enabled")).toBeInTheDocument();
      });

      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /save/i }))
          .toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(mockSetBulkMutate).toHaveBeenCalledWith(
          expect.objectContaining({ chargingEnabled: false }),
        );
      });
    });
  });

  describe("Encryption warning", () => {
    it("renders the warning at the top when the key is not configured", async () => {
      mockEncryptionHealthUseQuery.mockReturnValue({
        data: { configured: false },
      });

      renderWithProviders(<Settings />);
      await waitFor(() => {
        expect(
          screen.getByText("Encryption Key Not Configured"),
        ).toBeInTheDocument();
      });
    });

    it("hides the warning when the key is configured", async () => {
      mockEncryptionHealthUseQuery.mockReturnValue({
        data: { configured: true },
      });

      renderWithProviders(<Settings />);
      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });
      expect(
        screen.queryByText("Encryption Key Not Configured"),
      ).not.toBeInTheDocument();
    });
  });
});
