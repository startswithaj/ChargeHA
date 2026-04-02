import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { Stats } from "./Stats.tsx";
import { useStats } from "../../../hooks/useStats.ts";

vi.mock("../../../hooks/useStats.ts", () => ({
  useStats: vi.fn(() => ({
    period: "day",
    setPeriod: vi.fn(),
    resolution: "1h",
    setResolution: vi.fn(),
    cursor: new Date("2026-03-01"),
    cursorLabel: "Sat, Mar 1, 2026",
    isAtPresent: true,
    data: null,
    loading: false,
    error: null,
    goBack: vi.fn(),
    goForward: vi.fn(),
    goToToday: vi.fn(),
    drillDown: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useVehicles.ts", () => ({
  useVehicles: vi.fn(() => ({
    vehicles: [],
    loading: false,
    error: null,
    commandPending: {},
    startCharging: vi.fn(),
    stopCharging: vi.fn(),
    setAmps: vi.fn(),
    changeMode: vi.fn(),
    refreshVehicles: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useToast.tsx", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../hooks/useToast.tsx")>(),
  useToast: vi.fn(() => ({
    addToast: vi.fn(),
    removeToast: vi.fn(),
    toasts: [],
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useQueries: vi.fn(() => []),
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          isPending: false,
          error: null,
        })),
      },
    },
  },
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ComposedChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

describe("Stats", () => {
  const mockStatsData = {
    period: "day" as const,
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    energyBuckets: [
      {
        label: "10",
        solarProductionWh: 2000,
        solarWh: 1500,
        gridWh: 200,
        totalWh: 1700,
      },
      {
        label: "11",
        solarProductionWh: 3000,
        solarWh: 2200,
        gridWh: 100,
        totalWh: 2300,
      },
    ],
    homeSolarProductionWh: 5000,
    homeConsumedWh: 4000,
    homeSolarWh: 3700,
    homeGridWh: 300,
    homeSelfPoweredPercent: 75,
    solarProductionLine: [],
    // Vehicle charge data
    buckets: [
      { label: "10", solarWh: 800, gridWh: 200, awayWh: 0, totalWh: 1000 },
      { label: "11", solarWh: 600, gridWh: 100, awayWh: 0, totalWh: 700 },
    ],
    totalChargedWh: 1700,
    totalSolarWh: 1400,
    totalGridWh: 300,
    totalAwayWh: 0,
    selfPoweredPercent: 82,
  };

  type StatsReturn = ReturnType<typeof useStats>;

  const makeStatsReturn = (
    overrides: Partial<StatsReturn> = {},
  ): StatsReturn => ({
    period: "day",
    setPeriod: vi.fn(),
    resolution: "1h",
    setResolution: vi.fn(),
    cursor: new Date("2026-03-01"),
    cursorLabel: "Sat, Mar 1, 2026",
    isAtPresent: true,
    data: null,
    loading: false,
    error: null,
    goBack: vi.fn(),
    goForward: vi.fn(),
    goToToday: vi.fn(),
    drillDown: vi.fn(),
    ...overrides,
  });

  const setStats = (overrides: Partial<StatsReturn> = {}) => {
    vi.mocked(useStats).mockReturnValue(makeStatsReturn(overrides));
  };

  const renderStats = () => renderWithProviders(<Stats />);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Basic rendering ----

  it("renders period selector buttons", () => {
    renderStats();

    // Radix SegmentedControl renders labels twice (active + inactive)
    expect(screen.getAllByText("Day").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Month").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Year").length).toBeGreaterThanOrEqual(1);
  });

  it("renders navigation buttons", () => {
    renderStats();

    expect(screen.getByLabelText("Previous period")).toBeInTheDocument();
    expect(screen.getByLabelText("Next period")).toBeInTheDocument();
  });

  it("renders cursor label", () => {
    renderStats();

    expect(screen.getByText("Sat, Mar 1, 2026")).toBeInTheDocument();
  });

  it("renders summary card labels", () => {
    renderStats();

    expect(screen.getByText("Solar Produced")).toBeInTheDocument();
    expect(screen.getByText("Total Consumed")).toBeInTheDocument();
    expect(screen.getByText("Self Powered")).toBeInTheDocument();
  });

  // ---- Loading state ----

  it("shows — in summary cards when loading is true", () => {
    setStats({ loading: true });

    renderStats();

    // All three summary cards should show — when loading
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(3);
  });

  it("shows chart loading state when loading is true", () => {
    setStats({ loading: true });

    renderStats();

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  // ---- Data rendering (folds L214 + L280) ----

  it(
    "renders summary cards and Energy Sources values from data " +
      "(homeSelfPoweredPercent 75 → 75%, complement 25%)",
    () => {
      setStats({ isAtPresent: false, data: mockStatsData });

      renderStats();

      // homeSelfPoweredPercent = 75 → "75%" appears in summary card AND
      // in Energy Sources breakdown (≥ 2 occurrences).
      expect(screen.getAllByText("75%").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("25%")).toBeInTheDocument();
    },
  );

  it("renders chart when data is present", () => {
    setStats({ isAtPresent: false, data: mockStatsData });

    renderStats();

    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  // ---- Resolution toggle ----

  it("shows resolution toggle (1h / 15m) when period is day", () => {
    setStats();

    renderStats();

    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("15m").length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["month" as const, "March 2026"],
    ["year" as const, "2026"],
  ])(
    "does not show resolution toggle when period is %s",
    (period, cursorLabel) => {
      setStats({ period, cursorLabel });

      renderStats();

      expect(screen.queryByText("15m")).not.toBeInTheDocument();
    },
  );

  // ---- Energy source breakdown ----

  it("renders Energy Sources breakdown card", () => {
    renderStats();

    expect(screen.getByText("Energy Sources")).toBeInTheDocument();
    expect(screen.getByText("From Solar")).toBeInTheDocument();
    expect(screen.getByText("From Grid")).toBeInTheDocument();
  });

  // ---- Vehicle charging section ----

  it("does not show Vehicle Charging section when totalChargedWh is 0", () => {
    setStats({
      isAtPresent: false,
      data: { ...mockStatsData, totalChargedWh: 0 },
    });

    renderStats();

    expect(screen.queryByText("Vehicle Charging")).not.toBeInTheDocument();
  });

  it(
    "shows Vehicle Charging section with selfPoweredPercent and " +
      "chargeGridPercent when totalChargedWh > 0",
    async () => {
      setStats({ isAtPresent: false, data: mockStatsData });

      renderStats();

      expect(await screen.findByText("Vehicle Charging")).toBeInTheDocument();
      expect(screen.getByText("Total Charged")).toBeInTheDocument();
      // Vehicle charging breakdown also has solar/grid from rows
      const fromSolarItems = screen.getAllByText("From Solar");
      expect(fromSolarItems.length).toBe(2); // one in Energy Sources, one in Vehicle Charging
      const fromGridItems = screen.getAllByText("From Grid");
      expect(fromGridItems.length).toBe(2);
      // selfPoweredPercent = 82 in mock data
      expect(screen.getByText("82%")).toBeInTheDocument();
      // chargeGridPercent = round(300 / (1400 + 300) * 100) = round(17.6) = 18
      expect(screen.getByText("18%")).toBeInTheDocument();
    },
  );

  // ---- Away charging row ----

  it("does not show Away row when totalAwayWh is 0", () => {
    setStats({ isAtPresent: false, data: mockStatsData });

    renderStats();

    expect(screen.queryByText("Away")).not.toBeInTheDocument();
  });

  it("shows Away row when totalAwayWh > 0", async () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        totalAwayWh: 500,
        totalChargedWh: 2200, // 1400 solar + 300 grid + 500 away
      },
    });

    renderStats();

    expect(await screen.findByText("Away")).toBeInTheDocument();
    // awayPercent = round(500/2200 * 100) = round(22.7) = 23
    expect(screen.getByText("23%")).toBeInTheDocument();
  });

  // ---- Navigation callbacks (folds L381/L395/L409) ----

  it.each<
    [
      name: string,
      target: string,
      query: "label" | "text",
      key: "goBack" | "goForward" | "goToToday",
    ]
  >([
    ["Previous period", "Previous period", "label", "goBack"],
    ["Next period", "Next period", "label", "goForward"],
    ["cursor label", "Sat, Mar 1, 2026", "text", "goToToday"],
  ])("calls %s when clicked", (_name, target, query, key) => {
    const callback = vi.fn();
    setStats({ isAtPresent: false, [key]: callback });

    renderStats();

    const el = query === "label"
      ? screen.getByLabelText(target)
      : screen.getByText(target);
    fireEvent.click(el);

    expect(callback).toHaveBeenCalledOnce();
  });

  // ---- Chart legend ----

  it("renders chart legend labels", () => {
    renderStats();

    expect(screen.getByText("Solar → Home")).toBeInTheDocument();
    expect(screen.getByText("Solar → Car")).toBeInTheDocument();
    expect(screen.getByText("Solar → Grid")).toBeInTheDocument();
    expect(screen.getByText("Grid → Home")).toBeInTheDocument();
    expect(screen.getByText("Grid → Car")).toBeInTheDocument();
    expect(screen.getByText("Solar Production")).toBeInTheDocument();
  });

  // ---- Edge cases (honest retitle per audit) ----

  it(
    "still renders Vehicle Charging when totalSolar+totalGrid totals are 0",
    async () => {
      setStats({
        isAtPresent: false,
        data: {
          ...mockStatsData,
          totalSolarWh: 0,
          totalGridWh: 0,
          totalChargedWh: 1000,
        },
      });

      renderStats();

      // Vehicle Charging section is shown (totalChargedWh = 1000)
      expect(await screen.findByText("Vehicle Charging")).toBeInTheDocument();
    },
  );

  it("still renders Energy Sources when homeConsumedWh is 0", () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        homeConsumedWh: 0,
        homeSelfPoweredPercent: 0,
      },
    });

    renderStats();

    // Component renders without error; gridPercent collapses to 0%.
    expect(screen.getByText("Energy Sources")).toBeInTheDocument();
  });

  // ---- Cost cards ----

  it("shows Grid Cost and Solar Savings cards when tariff data exists", () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        energyBuckets: [
          {
            label: "10",
            solarProductionWh: 2000,
            solarWh: 1500,
            gridWh: 200,
            totalWh: 1700,
            costCents: 800,
          },
          {
            label: "11",
            solarProductionWh: 3000,
            solarWh: 2200,
            gridWh: 100,
            totalWh: 2300,
            costCents: 450,
          },
        ],
        totalCostCents: 1250,
        solarSavingsCents: 830,
        currencySymbol: "$",
        currencyCode: "AUD",
      },
    });

    renderStats();

    expect(screen.getByText("Grid Cost")).toBeInTheDocument();
    expect(screen.getAllByText("$12.50").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Solar Savings")).toBeInTheDocument();
    expect(screen.getAllByText("$8.30").length).toBeGreaterThanOrEqual(1);
  });

  it("does not show cost cards when no tariff data exists", () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        totalCostCents: 0,
        solarSavingsCents: 0,
        currencySymbol: "$",
        currencyCode: "AUD",
      },
    });

    renderStats();

    expect(screen.queryByText("Grid Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Solar Savings")).not.toBeInTheDocument();
  });

  it("shows Solar Savings card when only solar savings exist (all-solar charging)", () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        totalCostCents: 0,
        solarSavingsCents: 500,
        currencySymbol: "$",
        currencyCode: "AUD",
      },
    });

    renderStats();

    expect(screen.getByText("Solar Savings")).toBeInTheDocument();
    expect(screen.getAllByText("$5.00").length).toBeGreaterThanOrEqual(1);
  });
});
