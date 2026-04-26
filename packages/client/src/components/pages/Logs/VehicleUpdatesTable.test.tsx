import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { VehicleUpdatesTable } from "./VehicleUpdatesTable.tsx";
import { expectPagination } from "./test-helpers/pagination.tsx";
import type { VehicleUpdateEntry } from "../../../hooks/useVehicleUpdates.ts";

describe("VehicleUpdatesTable", () => {
  const makeEntry = (
    overrides: Partial<VehicleUpdateEntry> = {},
  ): VehicleUpdateEntry => {
    return {
      id: 1,
      timestamp: "2026-03-20T10:30:00",
      vehicleId: "v1",
      vehicleName: "Model 3",
      isOnline: true,
      isPluggedIn: true,
      isCharging: true,
      batteryLevel: 72,
      chargeLimit: 80,
      chargePowerKw: 7.4,
      chargeAmps: 32,
      chargeAmpsMax: 32,
      chargerVoltage: 230,
      energyAddedKwh: 5.2,
      minutesToFull: 45,
      isHome: true,
      ...overrides,
    };
  };

  const defaultProps = {
    readings: [] as VehicleUpdateEntry[],
    loading: false,
    total: 0,
    page: 0,
    onPageChange: vi.fn(),
    pageSize: 50,
    onPageSizeChange: vi.fn(),
    vehicles: [{ id: "v1", name: "Model 3" }],
  };

  it("shows loading state when loading with no data", () => {
    renderWithProviders(
      <VehicleUpdatesTable {...defaultProps} loading />,
    );
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("shows empty state when no readings", () => {
    renderWithProviders(<VehicleUpdatesTable {...defaultProps} />);
    expect(screen.getByText("No vehicle updates yet.")).toBeTruthy();
  });

  it("renders table headers", () => {
    const entry = makeEntry();
    renderWithProviders(
      <VehicleUpdatesTable {...defaultProps} readings={[entry]} total={1} />,
    );
    [
      "Time",
      "Vehicle",
      "Online",
      "Plugged In",
      "Charging",
      "Battery",
      "Limit",
      "Power",
      "Amps",
      "Voltage",
      "Added",
      "ETA",
    ].forEach((header) => {
      expect(screen.getByText(header)).toBeTruthy();
    });
  });

  it("renders reading data correctly", () => {
    const entry = makeEntry();
    renderWithProviders(
      <VehicleUpdatesTable {...defaultProps} readings={[entry]} total={1} />,
    );
    expect(screen.getByText("Model 3")).toBeTruthy();
    expect(screen.getByText("72%")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText("7.4 kW")).toBeTruthy();
    expect(screen.getByText("32/32A")).toBeTruthy();
    expect(screen.getByText("230V")).toBeTruthy();
    expect(screen.getByText("5.2 kWh")).toBeTruthy();
    expect(screen.getByText("45m")).toBeTruthy();
  });

  it.each([
    [false, "No", 3],
    [true, "Yes", 4],
  ])(
    "renders boolean fields as %s/%s",
    (value, label, expectedCount) => {
      const entry = makeEntry({
        isOnline: value,
        isPluggedIn: value,
        isCharging: value,
      });
      renderWithProviders(
        <VehicleUpdatesTable {...defaultProps} readings={[entry]} total={1} />,
      );
      const cells = screen.getAllByText(label);
      // When value=true, isHome (true) also renders Yes → 4. When false, only the
      // three flipped fields render No (isHome stays Yes) → 3.
      expect(cells.length).toBe(expectedCount);
    },
  );

  it.each([0, -1])(
    "renders dash for non-positive minutesToFull (%s)",
    (minutesToFull) => {
      const entry = makeEntry({ minutesToFull });
      renderWithProviders(
        <VehicleUpdatesTable {...defaultProps} readings={[entry]} total={1} />,
      );
      expect(screen.getByText("—")).toBeTruthy();
    },
  );

  it("pagination footer behaves correctly", () => {
    const entry = makeEntry();
    expectPagination(
      ({ total, page, onPageChange, pageSize }) => (
        <VehicleUpdatesTable
          {...defaultProps}
          readings={[entry]}
          total={total}
          page={page}
          onPageChange={onPageChange}
          pageSize={pageSize}
        />
      ),
      120,
      50,
      "Page 1 of 3 (120 entries)",
    );
  });
});
