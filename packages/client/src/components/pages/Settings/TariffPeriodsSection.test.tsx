import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import type { DayOfWeek } from "@chargeha/shared";
import { TariffPeriodsSection } from "./TariffPeriodsSection.tsx";
import { ALL_DAYS, EMPTY_FORM, type PeriodFormData } from "./tariffUtils.ts";
import type { TariffPeriod } from "./TariffSettings.tsx";

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

describe("TariffPeriodsSection", () => {
  // ALL_DAYS from tariffUtils is typed as string[] — narrow to DayOfWeek[] for test fixtures
  const TYPED_ALL_DAYS: DayOfWeek[] = ALL_DAYS as DayOfWeek[];

  const samplePeriod: TariffPeriod = {
    id: 1,
    label: "Peak",
    startTime: "06:00",
    endTime: "18:00",
    days: [...TYPED_ALL_DAYS],
    ratePerKwh: 0.35,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const samplePeriod2: TariffPeriod = {
    id: 2,
    label: "Off-Peak",
    startTime: "18:00",
    endTime: "06:00",
    days: [...TYPED_ALL_DAYS],
    ratePerKwh: 0.12,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const defaultProps = {
    periods: [] as TariffPeriod[],
    editingId: null as number | null,
    showAddForm: false,
    form: { ...EMPTY_FORM } as PeriodFormData,
    formError: null as string | null,
    hasOverlaps: false,
    overlapErrors: [],
    gapWarnings: [],
    currencySymbol: "$",
    onFormChange: vi.fn(),
    onStartAdd: vi.fn(),
    onStartEdit: vi.fn(),
    onUpdate: vi.fn(),
    onCancelEdit: vi.fn(),
    onAdd: vi.fn(),
    onCancelAdd: vi.fn(),
    onDelete: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders section title and Add Period button", () => {
    renderWithProviders(<TariffPeriodsSection {...defaultProps} />);
    expect(screen.getByText("Tariff Periods")).toBeInTheDocument();
    expect(screen.getByText("Add Period")).toBeInTheDocument();
  });

  it("shows empty state when no periods and no add form", () => {
    renderWithProviders(<TariffPeriodsSection {...defaultProps} />);
    expect(
      screen.getByText(
        "No tariff periods configured. Add one or load a preset above.",
      ),
    ).toBeInTheDocument();
  });

  it("does not show empty state when periods exist", () => {
    renderWithProviders(
      <TariffPeriodsSection {...defaultProps} periods={[samplePeriod]} />,
    );
    expect(
      screen.queryByText(
        "No tariff periods configured. Add one or load a preset above.",
      ),
    ).not.toBeInTheDocument();
  });

  it("does not show empty state when add form is shown", () => {
    renderWithProviders(
      <TariffPeriodsSection {...defaultProps} showAddForm />,
    );
    expect(
      screen.queryByText(
        "No tariff periods configured. Add one or load a preset above.",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders period details", () => {
    renderWithProviders(
      <TariffPeriodsSection {...defaultProps} periods={[samplePeriod]} />,
    );
    expect(screen.getByText("Peak")).toBeInTheDocument();
    expect(screen.getByText(/06:00/)).toBeInTheDocument();
    expect(screen.getByText(/18:00/)).toBeInTheDocument();
    expect(screen.getByText("Every day")).toBeInTheDocument();
  });

  it("calls onStartAdd when Add Period button is clicked", () => {
    const onStartAdd = vi.fn();
    renderWithProviders(
      <TariffPeriodsSection {...defaultProps} onStartAdd={onStartAdd} />,
    );
    fireEvent.click(screen.getByText("Add Period"));
    expect(onStartAdd).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when delete button is clicked", () => {
    const onDelete = vi.fn();
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        periods={[samplePeriod]}
        onDelete={onDelete}
      />,
    );
    // The trash button is an IconButton — find by aria/role
    const buttons = screen.getAllByRole("button");
    // Last two buttons per period are edit and delete
    const deleteButton = buttons[buttons.length - 1];
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("calls onStartEdit when edit button is clicked", () => {
    const onStartEdit = vi.fn();
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        periods={[samplePeriod]}
        onStartEdit={onStartEdit}
      />,
    );
    const buttons = screen.getAllByRole("button");
    // Edit button is second-to-last
    const editButton = buttons[buttons.length - 2];
    fireEvent.click(editButton);
    expect(onStartEdit).toHaveBeenCalledWith(samplePeriod);
  });

  it("shows edit form when editingId matches a period", () => {
    const editForm: PeriodFormData = {
      label: "Peak",
      startTime: "06:00",
      endTime: "18:00",
      days: [...TYPED_ALL_DAYS],
      ratePerKwh: "0.35",
    };
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        periods={[samplePeriod]}
        editingId={1}
        form={editForm}
      />,
    );
    // Edit form shows Update button instead of period display
    expect(screen.getByText("Update")).toBeInTheDocument();
  });

  it("shows add form when showAddForm is true", () => {
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        showAddForm
        form={{ ...EMPTY_FORM, label: "New", ratePerKwh: "0.30" }}
      />,
    );
    // The add form has its own submit button labeled "Add Period" (from PeriodForm)
    // Plus the section's "Add Period" button. Count to verify.
    const addButtons = screen.getAllByText("Add Period");
    expect(addButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("displays overlap errors", () => {
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        hasOverlaps
        overlapErrors={[
          { periodA: "Peak", periodB: "Shoulder", days: [...TYPED_ALL_DAYS] },
        ]}
      />,
    );
    expect(
      screen.getByText("Peak and Shoulder overlap on Every day"),
    ).toBeInTheDocument();
  });

  it("displays gap warnings", () => {
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        gapWarnings={[
          { days: [...TYPED_ALL_DAYS], startTime: "18:00", endTime: "24:00" },
        ]}
      />,
    );
    expect(screen.getByText(/No tariff rate defined for/)).toBeInTheDocument();
  });

  it("renders multiple periods", () => {
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        periods={[samplePeriod, samplePeriod2]}
      />,
    );
    expect(screen.getByText("Peak")).toBeInTheDocument();
    expect(screen.getByText("Off-Peak")).toBeInTheDocument();
  });

  it("shows form error in the add form", () => {
    renderWithProviders(
      <TariffPeriodsSection
        {...defaultProps}
        showAddForm
        formError="Rate must be a number >= 0"
      />,
    );
    expect(screen.getByText("Rate must be a number >= 0")).toBeInTheDocument();
  });
});
