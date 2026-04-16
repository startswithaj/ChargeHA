import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { TariffSettings } from "./TariffSettings.tsx";
import { ALL_DAYS } from "./tariffUtils.ts";

const {
  mockSaveDefaultsMutate,
  mockPresetMutate,
  mockAddMutate,
  mockUpdateMutate,
  mockDeleteMutate,
  mockSaveDefaultsReset,
  mockPresetReset,
  mockAddReset,
  mockUpdateReset,
  mockDeleteReset,
  mockInvalidateList,
  mockInvalidateCurrentRate,
  c,
  m,
} = vi.hoisted(() => ({
  mockSaveDefaultsMutate: vi.fn(),
  mockPresetMutate: vi.fn(),
  mockAddMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockSaveDefaultsReset: vi.fn(),
  mockPresetReset: vi.fn(),
  mockAddReset: vi.fn(),
  mockUpdateReset: vi.fn(),
  mockDeleteReset: vi.fn(),
  mockInvalidateList: vi.fn(),
  mockInvalidateCurrentRate: vi.fn(),
  c: {
    saveDefaultsOpts: {} as { onSuccess?: () => void },
    presetOpts: {} as { onSuccess?: () => void },
    addOpts: {} as { onSuccess?: () => void },
    updateOpts: {} as { onSuccess?: () => void },
    deleteOpts: {} as { onSuccess?: () => void },
  },
  m: {
    tariffListData: null as unknown,
    tariffListLoading: false,
    tariffListError: false,
    tariffListQueryError: null as unknown,
    saveDefaultsPending: false,
    saveDefaultsError: null as { message: string } | null,
    presetError: null as { message: string } | null,
    deleteError: null as { message: string } | null,
    addError: null as { message: string } | null,
    updateError: null as { message: string } | null,
  },
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    tariff: {
      list: {
        useQuery: vi.fn(() => ({
          data: m.tariffListData,
          isPending: m.tariffListLoading,
          isError: m.tariffListError,
          error: m.tariffListQueryError,
        })),
      },
      updateDefaultRate: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          c.saveDefaultsOpts = opts ?? {};
          return {
            mutate: mockSaveDefaultsMutate,
            isPending: m.saveDefaultsPending,
            error: m.saveDefaultsError,
            reset: mockSaveDefaultsReset,
          };
        }),
      },
      loadPreset: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          c.presetOpts = opts ?? {};
          return {
            mutate: mockPresetMutate,
            error: m.presetError,
            reset: mockPresetReset,
          };
        }),
      },
      create: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          c.addOpts = opts ?? {};
          return {
            mutate: mockAddMutate,
            error: m.addError,
            reset: mockAddReset,
          };
        }),
      },
      update: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          c.updateOpts = opts ?? {};
          return {
            mutate: mockUpdateMutate,
            error: m.updateError,
            reset: mockUpdateReset,
          };
        }),
      },
      delete: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          c.deleteOpts = opts ?? {};
          return {
            mutate: mockDeleteMutate,
            error: m.deleteError,
            reset: mockDeleteReset,
          };
        }),
      },
    },
    useUtils: vi.fn(() => ({
      tariff: {
        list: { invalidate: mockInvalidateList },
        currentRate: { invalidate: mockInvalidateCurrentRate },
      },
    })),
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

vi.mock("../../TimePicker/TimePicker.tsx", () => ({
  TimePicker: (
    { value, onChange }: { value: string; onChange: (v: string) => void },
  ) => (
    <input
      data-testid={`time-${value}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("../../../utils/Format.ts", () => ({
  formatRate: (rate: number, symbol: string) => `${symbol}${rate.toFixed(2)}`,
}));

describe("TariffSettings", () => {
  const sampleTariffConfig = {
    currencySymbol: "$",
    currencyCode: "AUD",
    defaultRatePerKwh: 0.3,
    periods: [
      {
        id: 1,
        label: "Peak",
        startTime: "06:00",
        endTime: "18:00",
        days: [...ALL_DAYS],
        ratePerKwh: 0.35,
        enabled: true,
        sortOrder: 0,
      },
    ],
  };

  beforeEach(() => {
    m.tariffListData = sampleTariffConfig;
    m.tariffListLoading = false;
    m.tariffListError = false;
    m.tariffListQueryError = null;
    m.saveDefaultsPending = false;
    m.saveDefaultsError = null;
    m.presetError = null;
    m.deleteError = null;
    m.addError = null;
    m.updateError = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    m.tariffListLoading = true;
    m.tariffListData = null;
    renderWithProviders(<TariffSettings />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders tariff section with title when data is loaded", () => {
    renderWithProviders(<TariffSettings />);
    expect(screen.getByText("Electricity Tariffs")).toBeInTheDocument();
  });

  it("renders currency config fields from query data", () => {
    renderWithProviders(<TariffSettings />);
    expect(screen.getByText("Currency symbol")).toBeInTheDocument();
    expect(screen.getByText("Currency code")).toBeInTheDocument();
    expect(screen.getByText("Default rate")).toBeInTheDocument();
  });

  it("renders period list from query data", () => {
    renderWithProviders(<TariffSettings />);
    expect(screen.getByText("Peak")).toBeInTheDocument();
  });

  it("displays query error message when query fails", () => {
    m.tariffListError = true;
    m.tariffListQueryError = new Error("Network error");
    renderWithProviders(<TariffSettings />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("displays fallback query error for non-Error objects", () => {
    m.tariffListError = true;
    m.tariffListQueryError = "string error";
    renderWithProviders(<TariffSettings />);
    expect(screen.getByText("Failed to load tariffs")).toBeInTheDocument();
  });

  it.each<[string, () => void, string]>([
    ["saveDefaults", () => {
      m.saveDefaultsError = { message: "Save failed" };
    }, "Save failed"],
    ["preset", () => {
      m.presetError = { message: "Preset failed" };
    }, "Preset failed"],
    ["delete", () => {
      m.deleteError = { message: "Delete failed" };
    }, "Delete failed"],
  ])("displays mutation error from %s", (_label, setError, message) => {
    setError();
    renderWithProviders(<TariffSettings />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("calls save defaults mutation with currency and rate", () => {
    renderWithProviders(<TariffSettings />);

    // Change the symbol to make dirty
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "€" } });

    // Save button should appear
    expect(screen.getByText("Save Currency & Default Rate"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByText("Save Currency & Default Rate"));

    expect(mockSaveDefaultsMutate).toHaveBeenCalledWith({
      ratePerKwh: 0.3,
      currencySymbol: "€",
      currencyCode: "AUD",
    });
  });

  it("does not call save when rate is invalid", () => {
    renderWithProviders(<TariffSettings />);

    // Change rate to invalid value
    const rateInput = screen.getByRole("spinbutton");
    fireEvent.change(rateInput, { target: { value: "abc" } });

    // Save button should appear (dirty)
    const saveButton = screen.getByText("Save Currency & Default Rate");
    fireEvent.click(saveButton);

    expect(mockSaveDefaultsMutate).not.toHaveBeenCalled();
  });

  it("does not call save when rate is negative", () => {
    renderWithProviders(<TariffSettings />);

    const rateInput = screen.getByRole("spinbutton");
    fireEvent.change(rateInput, { target: { value: "-1" } });

    const saveButton = screen.getByText("Save Currency & Default Rate");
    fireEvent.click(saveButton);

    expect(mockSaveDefaultsMutate).not.toHaveBeenCalled();
  });

  it("loads preset directly when no periods exist", () => {
    m.tariffListData = { ...sampleTariffConfig, periods: [] };
    renderWithProviders(<TariffSettings />);

    fireEvent.click(screen.getByText("Flat Rate"));
    expect(mockPresetMutate).toHaveBeenCalledWith({ template: "flat" });
  });

  it("shows confirmation when loading preset with existing periods", () => {
    renderWithProviders(<TariffSettings />);

    fireEvent.click(screen.getByText("Flat Rate"));
    // Should show confirmation, not call mutate yet
    expect(mockPresetMutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "This will replace all existing tariff periods. Continue?",
      ),
    ).toBeInTheDocument();
  });

  it("calls preset mutate after confirmation", () => {
    renderWithProviders(<TariffSettings />);

    fireEvent.click(screen.getByText("Flat Rate"));
    fireEvent.click(screen.getByText("Replace"));
    expect(mockPresetMutate).toHaveBeenCalledWith({ template: "flat" });
  });

  it("cancels preset confirmation", () => {
    renderWithProviders(<TariffSettings />);

    fireEvent.click(screen.getByText("Flat Rate"));
    expect(
      screen.getByText(
        "This will replace all existing tariff periods. Continue?",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(
      screen.queryByText(
        "This will replace all existing tariff periods. Continue?",
      ),
    ).not.toBeInTheDocument();
  });

  it("calls delete mutation when period delete is clicked", () => {
    renderWithProviders(<TariffSettings />);

    // The period has edit and delete icon buttons at the end
    const allButtons = screen.getAllByRole("button");
    // Delete button should be after edit in the period list
    // Let's just click the last icon-like button (trash icon)
    fireEvent.click(allButtons[allButtons.length - 1]);
    expect(mockDeleteMutate).toHaveBeenCalledWith({ id: 1 });
  });

  it("opens add form and calls add mutation with valid data", () => {
    renderWithProviders(<TariffSettings />);

    // Click "Add Period" button in the TariffPeriodsSection header
    fireEvent.click(screen.getByText("Add Period"));

    // The add form should now be visible — fill in the form via PeriodForm
    // Change label
    const labelInput = screen.getByPlaceholderText("e.g. Off-Peak");
    fireEvent.change(labelInput, { target: { value: "Off-Peak" } });

    // Change rate
    const rateInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(rateInput, { target: { value: "0.12" } });

    // Click the add form's submit button (the PeriodForm "Add Period")
    const addButtons = screen.getAllByText("Add Period");
    // The second "Add Period" button is from the PeriodForm
    const formSubmit = addButtons[addButtons.length - 1];
    fireEvent.click(formSubmit);

    expect(mockAddMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Off-Peak",
        ratePerKwh: 0.12,
      }),
    );
  });

  it("shows form error for invalid rate on add", () => {
    renderWithProviders(<TariffSettings />);

    fireEvent.click(screen.getByText("Add Period"));

    // Set label to make form look valid except rate
    const labelInput = screen.getByPlaceholderText("e.g. Off-Peak");
    fireEvent.change(labelInput, { target: { value: "Test" } });

    // Leave rate empty and try submitting (rate "" parses to NaN)
    const addButtons = screen.getAllByText("Add Period");
    const formSubmit = addButtons[addButtons.length - 1];
    // Button is disabled when rate is invalid, so the handler won't fire via button click
    // Instead verify the button is disabled
    expect(formSubmit).toBeDisabled();
  });

  it("saves defaults onSuccess invalidates queries", () => {
    renderWithProviders(<TariffSettings />);
    act(() => {
      c.saveDefaultsOpts.onSuccess?.();
    });
    expect(mockInvalidateList).toHaveBeenCalled();
    expect(mockInvalidateCurrentRate).toHaveBeenCalled();
  });

  it("preset onSuccess invalidates list", () => {
    renderWithProviders(<TariffSettings />);
    act(() => {
      c.presetOpts.onSuccess?.();
    });
    expect(mockInvalidateList).toHaveBeenCalled();
  });

  it("add onSuccess invalidates list and resets form", () => {
    renderWithProviders(<TariffSettings />);
    act(() => {
      c.addOpts.onSuccess?.();
    });
    expect(mockInvalidateList).toHaveBeenCalled();
  });

  it("update onSuccess invalidates list and currentRate", () => {
    renderWithProviders(<TariffSettings />);
    act(() => {
      c.updateOpts.onSuccess?.();
    });
    expect(mockInvalidateList).toHaveBeenCalled();
    expect(mockInvalidateCurrentRate).toHaveBeenCalled();
  });

  it("delete onSuccess invalidates list", () => {
    renderWithProviders(<TariffSettings />);
    act(() => {
      c.deleteOpts.onSuccess?.();
    });
    expect(mockInvalidateList).toHaveBeenCalled();
  });

  it("displays add mutation error in form", () => {
    m.addError = { message: "Create failed" };
    // We need to trigger the add form to be shown
    renderWithProviders(<TariffSettings />);
    fireEvent.click(screen.getByText("Add Period"));
    expect(screen.getByText("Create failed")).toBeInTheDocument();
  });

  it("displays update mutation error in form when editing", () => {
    m.updateError = { message: "Update failed" };
    renderWithProviders(<TariffSettings />);

    // Click edit on the period
    const buttons = screen.getAllByRole("button");
    // Edit is second-to-last button
    fireEvent.click(buttons[buttons.length - 2]);

    expect(screen.getByText("Update failed")).toBeInTheDocument();
  });
});
