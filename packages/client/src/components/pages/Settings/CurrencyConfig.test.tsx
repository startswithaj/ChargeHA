import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { CurrencyConfig } from "./CurrencyConfig.tsx";

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title }: { children: React.ReactNode; title: string },
  ) => (
    <div>
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

describe("CurrencyConfig", () => {
  const defaultProps = {
    localSymbol: "$",
    localCode: "AUD",
    localDefaultRate: "0.30",
    defaultsDirty: false,
    savingDefault: false,
    onSymbolChange: vi.fn(),
    onCodeChange: vi.fn(),
    onDefaultRateChange: vi.fn(),
    onSave: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders currency symbol, code, and default rate fields", () => {
    renderWithProviders(<CurrencyConfig {...defaultProps} />);
    expect(screen.getByText("Currency symbol")).toBeInTheDocument();
    expect(screen.getByText("Currency code")).toBeInTheDocument();
    expect(screen.getByText("Default rate")).toBeInTheDocument();
  });

  it("displays the currency symbol in the rate label", () => {
    renderWithProviders(<CurrencyConfig {...defaultProps} localSymbol="€" />);
    expect(screen.getByText("€/kWh")).toBeInTheDocument();
  });

  it("does not show save button when defaults are not dirty", () => {
    renderWithProviders(<CurrencyConfig {...defaultProps} />);
    expect(screen.queryByText("Save Currency & Default Rate")).not
      .toBeInTheDocument();
  });

  it("shows save button when defaults are dirty", () => {
    renderWithProviders(<CurrencyConfig {...defaultProps} defaultsDirty />);
    expect(screen.getByText("Save Currency & Default Rate"))
      .toBeInTheDocument();
  });

  it("shows 'Saving...' when save is pending", () => {
    renderWithProviders(
      <CurrencyConfig {...defaultProps} defaultsDirty savingDefault />,
    );
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("calls onSave when save button is clicked", () => {
    const onSave = vi.fn();
    renderWithProviders(
      <CurrencyConfig {...defaultProps} defaultsDirty onSave={onSave} />,
    );
    fireEvent.click(screen.getByText("Save Currency & Default Rate"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("calls onSymbolChange when symbol input changes", () => {
    const onSymbolChange = vi.fn();
    renderWithProviders(
      <CurrencyConfig {...defaultProps} onSymbolChange={onSymbolChange} />,
    );
    const inputs = screen.getAllByRole("textbox");
    // First textbox is the symbol input
    fireEvent.change(inputs[0], { target: { value: "€" } });
    expect(onSymbolChange).toHaveBeenCalledWith("€");
  });

  it("calls onCodeChange when code input changes", () => {
    const onCodeChange = vi.fn();
    renderWithProviders(
      <CurrencyConfig {...defaultProps} onCodeChange={onCodeChange} />,
    );
    const inputs = screen.getAllByRole("textbox");
    // Second textbox is the code input
    fireEvent.change(inputs[1], { target: { value: "EUR" } });
    expect(onCodeChange).toHaveBeenCalledWith("EUR");
  });

  it("calls onDefaultRateChange when rate input changes", () => {
    const onDefaultRateChange = vi.fn();
    renderWithProviders(
      <CurrencyConfig
        {...defaultProps}
        onDefaultRateChange={onDefaultRateChange}
      />,
    );
    const rateInput = screen.getByRole("spinbutton");
    fireEvent.change(rateInput, { target: { value: "0.45" } });
    expect(onDefaultRateChange).toHaveBeenCalledWith("0.45");
  });
});
