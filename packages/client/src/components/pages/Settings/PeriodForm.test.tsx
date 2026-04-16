import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { PeriodForm } from "./PeriodForm.tsx";
import { ALL_DAYS, EMPTY_FORM, type PeriodFormData } from "./tariffUtils.ts";

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

describe("PeriodForm", () => {
  const validForm: PeriodFormData = {
    label: "Peak",
    startTime: "06:00",
    endTime: "18:00",
    days: [...ALL_DAYS],
    ratePerKwh: "0.35",
  };

  const defaultProps = {
    form: validForm,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    submitLabel: "Add Period",
    error: null as string | null,
    hasOverlaps: false,
    currencySymbol: "$",
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders label, time, rate, and day inputs", () => {
    renderWithProviders(<PeriodForm {...defaultProps} />);
    expect(screen.getByPlaceholderText("e.g. Off-Peak")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
    expect(screen.getByText("$/kWh")).toBeInTheDocument();
    expect(screen.getByText("Mon")).toBeInTheDocument();
  });

  it("renders submit and cancel buttons", () => {
    renderWithProviders(<PeriodForm {...defaultProps} />);
    expect(screen.getByText("Add Period")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onSubmit when submit is clicked with valid form", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<PeriodForm {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Add Period"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel is clicked", () => {
    const onCancel = vi.fn();
    renderWithProviders(<PeriodForm {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it.each<
    [string, Partial<PeriodFormData> | null, { hasOverlaps?: boolean }]
  >([
    ["label is empty", { label: "" }, {}],
    ["rate is negative", { ratePerKwh: "-1" }, {}],
    ["rate is not a number", { ratePerKwh: "abc" }, {}],
    ["days array is empty", { days: [] }, {}],
    ["startTime is invalid format", { startTime: "6:00" }, {}],
    ["hasOverlaps is true", null, { hasOverlaps: true }],
  ])("disables submit when %s", (_label, formOverride, propOverride) => {
    const form = formOverride === null
      ? validForm
      : { ...validForm, ...formOverride };
    renderWithProviders(
      <PeriodForm {...defaultProps} {...propOverride} form={form} />,
    );
    expect(screen.getByText("Add Period")).toBeDisabled();
  });

  it("enables submit for valid form with rate of 0", () => {
    renderWithProviders(
      <PeriodForm {...defaultProps} form={{ ...validForm, ratePerKwh: "0" }} />,
    );
    expect(screen.getByText("Add Period")).not.toBeDisabled();
  });

  it("displays error message when error is provided", () => {
    renderWithProviders(
      <PeriodForm {...defaultProps} error="Rate must be a number >= 0" />,
    );
    expect(screen.getByText("Rate must be a number >= 0")).toBeInTheDocument();
  });

  it("calls onChange when label input changes", () => {
    const onChange = vi.fn();
    renderWithProviders(<PeriodForm {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. Off-Peak"), {
      target: { value: "Off-Peak" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...validForm, label: "Off-Peak" });
  });

  it("calls onChange when rate input changes", () => {
    const onChange = vi.fn();
    renderWithProviders(<PeriodForm {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "0.50" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...validForm, ratePerKwh: "0.50" });
  });

  it("renders custom submit label", () => {
    renderWithProviders(
      <PeriodForm {...defaultProps} submitLabel="Update" />,
    );
    expect(screen.getByText("Update")).toBeInTheDocument();
  });

  it("renders custom currency symbol", () => {
    renderWithProviders(
      <PeriodForm {...defaultProps} currencySymbol="€" />,
    );
    expect(screen.getByText("€/kWh")).toBeInTheDocument();
  });

  it("renders with empty form defaults", () => {
    renderWithProviders(
      <PeriodForm {...defaultProps} form={{ ...EMPTY_FORM }} />,
    );
    expect(screen.getByText("Add Period")).toBeDisabled();
  });
});
