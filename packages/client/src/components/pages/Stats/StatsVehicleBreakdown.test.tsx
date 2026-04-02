import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { StatsResponse } from "@chargeha/shared";
import { renderWithProviders } from "../../../test-utils.tsx";
import { StatsVehicleBreakdown } from "./StatsVehicleBreakdown.tsx";
import { useVehicleBreakdowns } from "../../../hooks/useVehicleBreakdowns.ts";

vi.mock("../../../hooks/useVehicleBreakdowns.ts", () => ({
  useVehicleBreakdowns: vi.fn(),
}));

describe("StatsVehicleBreakdown", () => {
  const mockUseVehicleBreakdowns = vi.mocked(useVehicleBreakdowns);

  const baseData: StatsResponse = {
    period: "day",
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    energyBuckets: [],
    homeSolarProductionWh: 0,
    homeConsumedWh: 0,
    homeSolarWh: 0,
    homeGridWh: 0,
    homeSelfPoweredPercent: 0,
    solarProductionLine: [],
    buckets: [],
    totalChargedWh: 1700,
    totalSolarWh: 1400,
    totalGridWh: 300,
    totalAwayWh: 0,
    selfPoweredPercent: 82,
  };

  const renderComponent = () =>
    renderWithProviders(
      <StatsVehicleBreakdown
        data={baseData}
        loading={false}
        period="day"
        cursor={new Date("2026-03-01")}
        resolution="1h"
      />,
    );

  type BreakdownsReturn = ReturnType<typeof useVehicleBreakdowns>;

  const setBreakdowns = (overrides: Partial<BreakdownsReturn>) => {
    mockUseVehicleBreakdowns.mockReturnValue({
      hasChargeData: true,
      hasConfiguredVehicles: true,
      vehicleBreakdownsLoading: false,
      currencySymbol: "$",
      gridPercent: 0,
      chargeGridPercent: 0,
      activeVehicleBreakdowns: [],
      ...overrides,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders per-vehicle card titles when breakdowns are available", () => {
    setBreakdowns({
      activeVehicleBreakdowns: [
        {
          vehicleId: "VIN-1",
          vehicleName: "Model Y",
          totalChargedWh: 1700,
          totalSolarWh: 1400,
          totalGridWh: 300,
          totalCostCents: 20,
          evSolarSavingsCents: 1,
        },
      ],
    });

    renderComponent();

    expect(screen.getByText("Model Y")).toBeInTheDocument();
    expect(screen.queryByText("Vehicle Charging")).not.toBeInTheDocument();
  });

  it("does not render generic fallback while per-vehicle breakdowns are loading", () => {
    setBreakdowns({ vehicleBreakdownsLoading: true });

    renderComponent();

    expect(screen.queryByText("Vehicle Charging")).not.toBeInTheDocument();
  });

  it("renders generic fallback only when no configured vehicles exist", () => {
    setBreakdowns({ hasConfiguredVehicles: false });

    renderComponent();

    expect(screen.getByText("Vehicle Charging")).toBeInTheDocument();
  });
});
