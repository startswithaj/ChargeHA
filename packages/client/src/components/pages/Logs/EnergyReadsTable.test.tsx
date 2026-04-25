import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { EnergyReadsTable } from "./EnergyReadsTable.tsx";
import { expectPagination } from "./test-helpers/pagination.tsx";
import type { EnergyReadingEntry } from "../../../hooks/useEnergyReadings.ts";

describe("EnergyReadsTable", () => {
  const makeReading = (
    overrides: Partial<EnergyReadingEntry> = {},
  ): EnergyReadingEntry => {
    return {
      id: 1,
      timestamp: "2026-03-20T10:30:00",
      solarProductionW: 3500,
      gridPowerW: 1200,
      homeConsumptionW: 2800,
      batteryPowerW: 500,
      batterySoc: 72,
      ratePerKwh: 25.5,
      ...overrides,
    };
  };

  const defaultProps = {
    readings: [] as EnergyReadingEntry[],
    loading: false,
    total: 0,
    page: 0,
    onPageChange: vi.fn(),
    pageSize: 50,
    onPageSizeChange: vi.fn(),
  };

  it("shows loading state when loading with no data", () => {
    renderWithProviders(
      <EnergyReadsTable {...defaultProps} loading />,
    );
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("shows empty state when no readings", () => {
    renderWithProviders(<EnergyReadsTable {...defaultProps} />);
    expect(screen.getByText("No energy readings yet.")).toBeTruthy();
  });

  it("renders table headers", () => {
    const reading = makeReading();
    renderWithProviders(
      <EnergyReadsTable {...defaultProps} readings={[reading]} total={1} />,
    );
    [
      "Time",
      "Solar",
      "Grid",
      "Home",
      "Battery (W)",
      "SoC",
      "Rate",
    ].forEach((header) => {
      expect(screen.getByText(header)).toBeTruthy();
    });
  });

  it("renders reading data with formatted watts", () => {
    const reading = makeReading();
    renderWithProviders(
      <EnergyReadsTable {...defaultProps} readings={[reading]} total={1} />,
    );
    // fmt() rounds and adds "W" suffix
    expect(screen.getByText("3,500W")).toBeTruthy();
    expect(screen.getByText("1,200W")).toBeTruthy();
    expect(screen.getByText("2,800W")).toBeTruthy();
    expect(screen.getByText("500W")).toBeTruthy();
  });

  it("renders SoC percentage", () => {
    const reading = makeReading({ batterySoc: 72 });
    renderWithProviders(
      <EnergyReadsTable {...defaultProps} readings={[reading]} total={1} />,
    );
    expect(screen.getByText("72%")).toBeTruthy();
  });

  it("renders rate with cents symbol", () => {
    const reading = makeReading({ ratePerKwh: 25.5 });
    renderWithProviders(
      <EnergyReadsTable {...defaultProps} readings={[reading]} total={1} />,
    );
    expect(screen.getByText("25.5¢")).toBeTruthy();
  });

  it("renders all dashes for null optional fields", () => {
    const reading = makeReading({
      batteryPowerW: null,
      batterySoc: null,
      ratePerKwh: null,
    });
    renderWithProviders(
      <EnergyReadsTable {...defaultProps} readings={[reading]} total={1} />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(3);
  });

  it("pagination footer behaves correctly", () => {
    const reading = makeReading();
    expectPagination(
      ({ total, page, onPageChange, pageSize }) => (
        <EnergyReadsTable
          {...defaultProps}
          readings={[reading]}
          total={total}
          page={page}
          onPageChange={onPageChange}
          pageSize={pageSize}
        />
      ),
      200,
      50,
      "Page 1 of 4 (200 entries)",
    );
  });
});
