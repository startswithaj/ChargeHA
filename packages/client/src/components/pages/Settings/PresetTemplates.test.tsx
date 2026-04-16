import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { PresetTemplates } from "./PresetTemplates.tsx";

describe("PresetTemplates", () => {
  const defaultProps = {
    hasPeriods: false,
    confirmPreset: null as string | null,
    onConfirmPreset: vi.fn(),
    onLoadPreset: vi.fn(),
    onCancelConfirm: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders all three preset buttons", () => {
    renderWithProviders(<PresetTemplates {...defaultProps} />);
    expect(screen.getByText("Flat Rate")).toBeInTheDocument();
    expect(screen.getByText("Time of Use")).toBeInTheDocument();
    expect(screen.getByText("EV Time of Use")).toBeInTheDocument();
  });

  it("renders section title and description", () => {
    renderWithProviders(<PresetTemplates {...defaultProps} />);
    expect(screen.getByText("Quick Setup")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Load a preset tariff template. This replaces all existing periods.",
      ),
    ).toBeInTheDocument();
  });

  it("calls onLoadPreset directly when hasPeriods is false", () => {
    const onLoadPreset = vi.fn();
    renderWithProviders(
      <PresetTemplates {...defaultProps} onLoadPreset={onLoadPreset} />,
    );
    fireEvent.click(screen.getByText("Flat Rate"));
    expect(onLoadPreset).toHaveBeenCalledWith("flat");
  });

  it("calls onConfirmPreset when hasPeriods is true", () => {
    const onConfirmPreset = vi.fn();
    renderWithProviders(
      <PresetTemplates
        {...defaultProps}
        hasPeriods
        onConfirmPreset={onConfirmPreset}
      />,
    );
    fireEvent.click(screen.getByText("Time of Use"));
    expect(onConfirmPreset).toHaveBeenCalledWith("tou");
  });

  it("does not show confirmation dialog when confirmPreset is null", () => {
    renderWithProviders(<PresetTemplates {...defaultProps} />);
    expect(
      screen.queryByText(
        "This will replace all existing tariff periods. Continue?",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows confirmation dialog when confirmPreset is set", () => {
    renderWithProviders(
      <PresetTemplates {...defaultProps} confirmPreset="flat" />,
    );
    expect(
      screen.getByText(
        "This will replace all existing tariff periods. Continue?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onLoadPreset with confirmPreset key when Replace is clicked", () => {
    const onLoadPreset = vi.fn();
    renderWithProviders(
      <PresetTemplates
        {...defaultProps}
        confirmPreset="ev-tou"
        onLoadPreset={onLoadPreset}
      />,
    );
    fireEvent.click(screen.getByText("Replace"));
    expect(onLoadPreset).toHaveBeenCalledWith("ev-tou");
  });

  it("calls onCancelConfirm when Cancel is clicked", () => {
    const onCancelConfirm = vi.fn();
    renderWithProviders(
      <PresetTemplates
        {...defaultProps}
        confirmPreset="flat"
        onCancelConfirm={onCancelConfirm}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancelConfirm).toHaveBeenCalledTimes(1);
  });
});
