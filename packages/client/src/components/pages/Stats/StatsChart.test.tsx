import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

// Tooltip-content capture and shared fixture factory — held in a hoisted
// container so the `vi.mock("recharts")` factory and the test bodies can both
// reach them without a module-level `let`/`function` (banned by the
// `no-test-globals` lint rule). `vi.hoisted` is the rule's only escape hatch.
const { tooltipState, makeStatsData } = vi.hoisted(() => {
  type SR = import("@chargeha/shared").StatsResponse;
  const tooltipState: { captured: ReactElement | null } = { captured: null };
  const makeStatsData = (overrides?: Partial<SR>): SR => ({
    period: "day",
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    homeSolarProductionWh: 8000,
    homeConsumedWh: 7000,
    homeSolarWh: 5000,
    homeGridWh: 2000,
    homeSelfPoweredPercent: 71,
    solarProductionLine: [],
    totalChargedWh: 3000,
    totalSolarWh: 2000,
    totalGridWh: 1000,
    totalAwayWh: 0,
    selfPoweredPercent: 67,
    totalCostCents: 500,
    solarSavingsCents: 200,
    currencySymbol: "$",
    tariffBreakdown: [],
    vehicleSoc: [],
    energyBuckets: [
      {
        label: "10",
        solarProductionWh: 2000,
        solarWh: 1500,
        gridWh: 200,
        totalWh: 1700,
        costCents: 50,
      },
      {
        label: "11",
        solarProductionWh: 3000,
        solarWh: 2200,
        gridWh: 500,
        totalWh: 2700,
        costCents: 120,
      },
    ],
    buckets: [
      {
        label: "10",
        solarWh: 500,
        gridWh: 100,
        awayWh: 0,
        totalWh: 600,
        costCents: 20,
      },
      {
        label: "11",
        solarWh: 700,
        gridWh: 300,
        awayWh: 0,
        totalWh: 1000,
        costCents: 70,
      },
    ],
    ...overrides,
  });
  return { tooltipState, makeStatsData };
});

vi.mock("recharts", () => {
  // Real recharts inspects its children via React.Children.map and matches
  // against known component types (Bar, Line, etc. by displayName) to decide
  // what to draw. A wrapper component (e.g. <ChartBars />) breaks this — real
  // recharts sees one anonymous child and renders nothing. The mock below
  // mirrors that contract so the test fails loudly if anyone wraps recharts
  // children in a custom component.
  const RECHARTS_CHILD_NAMES = new Set([
    "Bar",
    "Line",
    "XAxis",
    "YAxis",
    "CartesianGrid",
    "Tooltip",
  ]);

  const makeRechartsStub = (name: string) => {
    const Stub = () => null;
    Stub.displayName = name;
    return Stub;
  };

  const Bar = makeRechartsStub("Bar");
  const Line = makeRechartsStub("Line");
  const XAxis = makeRechartsStub("XAxis");
  const YAxis = makeRechartsStub("YAxis");
  const CartesianGrid = makeRechartsStub("CartesianGrid");
  const Tooltip = ({ content }: { content: ReactNode }) => {
    if (isValidElement(content)) {
      tooltipState.captured = content;
    }
    return <div data-testid="tooltip-wrapper" />;
  };
  Tooltip.displayName = "Tooltip";

  // Recursively walk children, transparently descending into Fragments
  // (real recharts does this too — that's why `{chartBars()}` works but
  // `<ChartBars />` doesn't). Each leaf must be a known recharts type.
  const assertRechartsChild = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        assertRechartsChild(
          (child.props as { children?: ReactNode }).children,
        );
        return;
      }
      const type = child.type as { displayName?: string; name?: string };
      const name = type?.displayName ?? type?.name ?? "(anonymous)";
      if (!RECHARTS_CHILD_NAMES.has(name)) {
        throw new Error(
          `ComposedChart received non-recharts child <${name}>. Bar/Line/etc. must be direct children (or inside a fragment) — wrapping them in a custom component breaks real recharts' Children.map traversal.`,
        );
      }
    });
  };

  const ComposedChart = ({ children }: { children: ReactNode }) => {
    assertRechartsChild(children);
    return <div data-testid="chart">{children}</div>;
  };

  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
  };
});

vi.mock("./Stats.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => `mock-${String(prop)}` }),
}));

vi.mock("../../../utils/Format.ts", () => ({
  formatCost: (cents: number, sym: string) =>
    `${sym}${(cents / 100).toFixed(2)}`,
}));

import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { StatsChart } from "./StatsChart.tsx";
import type { StatsResponse } from "@chargeha/shared";

describe("StatsChart", () => {
  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  const defaultProps = {
    data: null as StatsResponse | null,
    loading: false,
    period: "day" as const,
    resolution: "1h" as const,
    setResolution: vi.fn(),
    dateCursor: new Date(2026, 2, 1), // March 1, 2026
    onDrillDown: vi.fn(),
  };

  it("shows loading text when loading", () => {
    renderWithProviders(<StatsChart {...defaultProps} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders chart when data is provided", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} />,
    );
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("renders empty chart when data is null and not loading", () => {
    renderWithProviders(<StatsChart {...defaultProps} />);
    // No chart, no loading
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("shows resolution toggle for day period", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} period="day" />,
    );
    // SegmentedControl renders labels twice (active + inactive) — use getAllByText
    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("15m").length).toBeGreaterThanOrEqual(1);
  });

  it.each([["month" as const], ["year" as const]])(
    "does not show resolution toggle for %s period",
    (period) => {
      renderWithProviders(
        <StatsChart
          {...defaultProps}
          data={makeStatsData({ period })}
          period={period}
        />,
      );
      expect(screen.queryByText("1h")).not.toBeInTheDocument();
    },
  );

  it("renders legend items", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} />,
    );
    expect(screen.getByText(/Solar → Home/)).toBeInTheDocument();
    expect(screen.getByText(/Solar → Car/)).toBeInTheDocument();
    expect(screen.getByText(/Solar → Grid/)).toBeInTheDocument();
    expect(screen.getByText(/Grid → Home/)).toBeInTheDocument();
    expect(screen.getByText(/Grid → Car/)).toBeInTheDocument();
    expect(screen.getByText(/Solar Production/)).toBeInTheDocument();
    expect(screen.getByText(/Total Consumption/)).toBeInTheDocument();
  });

  it("calls setResolution when resolution toggle changes", () => {
    const setResolution = vi.fn();
    renderWithProviders(
      <StatsChart
        {...defaultProps}
        data={makeStatsData()}
        period="day"
        setResolution={setResolution}
      />,
    );
    // SegmentedControl renders labels twice — click the first "15m"
    fireEvent.click(screen.getAllByText("15m")[0]);
    expect(setResolution).toHaveBeenCalledWith("15m");
  });

  // Folded edge-data cases: each variant only proves "chart still renders".
  // Audit notes the vacuousness — kept as a single row table so future work
  // that surfaces props on the mock can replace the assertion in one place.
  it.each<[name: string, overrides: Partial<StatsResponse>]>([
    [
      "zero values across buckets",
      {
        energyBuckets: [
          {
            label: "0",
            solarProductionWh: 0,
            solarWh: 0,
            gridWh: 0,
            totalWh: 0,
            costCents: 0,
          },
        ],
        buckets: [
          {
            label: "0",
            solarWh: 0,
            gridWh: 0,
            awayWh: 0,
            totalWh: 0,
            costCents: 0,
          },
        ],
      },
    ],
    [
      "missing charge buckets",
      {
        energyBuckets: [
          {
            label: "5",
            solarProductionWh: 1000,
            solarWh: 800,
            gridWh: 100,
            totalWh: 900,
            costCents: 30,
          },
        ],
        buckets: [],
      },
    ],
    [
      "totalCostCents only",
      { totalCostCents: 100, solarSavingsCents: 0 },
    ],
    [
      "solarSavingsCents only",
      { totalCostCents: 0, solarSavingsCents: 50 },
    ],
    [
      "no cost data",
      { totalCostCents: 0, solarSavingsCents: 0 },
    ],
    [
      "vehicleSoc payload",
      {
        vehicleSoc: [
          [{ vehicleId: "v1", vehicleName: "Tesla", batteryLevel: 80 }],
          [],
        ],
      },
    ],
  ])("renders chart for edge case: %s", (_name, overrides) => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData(overrides)} />,
    );
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });
});

describe("CustomTooltip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tooltipState.captured = null;
  });
  afterEach(cleanup);

  type ChartOverrides = {
    period?: StatsResponse["period"];
    resolution?: "1h" | "15m";
    dateCursor?: Date;
    bucketLabel?: string;
  };

  // Drives the tooltip via the closure-captured content element. The
  // unmount/cleanup dance is the minimum surface needed to reach the inner
  // `<Tooltip content={...}/>` without exposing CustomTooltip directly.
  const captureTooltipContent = (chart: ChartOverrides = {}) => {
    tooltipState.captured = null;
    const period = chart.period ?? "day";
    const resolution = chart.resolution ?? "1h";
    const dateCursor = chart.dateCursor ?? new Date(2026, 2, 1);
    const label = chart.bucketLabel ?? "10";
    const data = makeStatsData({
      period,
      energyBuckets: [{
        label,
        solarProductionWh: 2000,
        solarWh: 1500,
        gridWh: 200,
        totalWh: 1700,
        costCents: 50,
      }],
      buckets: [{
        label,
        solarWh: 500,
        gridWh: 100,
        awayWh: 0,
        totalWh: 600,
        costCents: 20,
      }],
    });
    const { unmount } = renderWithProviders(
      <StatsChart
        data={data}
        loading={false}
        period={period}
        resolution={resolution}
        setResolution={vi.fn()}
        dateCursor={dateCursor}
        onDrillDown={vi.fn()}
      />,
    );
    unmount();
    cleanup();

    if (!tooltipState.captured) {
      throw new Error("Tooltip content not captured");
    }
    return tooltipState.captured;
  };

  const renderTooltipWith = (
    props: Record<string, unknown>,
    chart?: ChartOverrides,
  ) => render(cloneElement(captureTooltipContent(chart), props));

  it("returns null when not active", () => {
    const { container } = renderTooltipWith({
      active: false,
      payload: [],
      label: "10",
    });
    expect(container.innerHTML).toBe("");
  });

  it("returns null when payload is empty", () => {
    const { container } = renderTooltipWith({
      active: true,
      payload: [],
      label: "10",
    });
    expect(container.innerHTML).toBe("");
  });

  it("returns null when label is empty (buildHeaderLabel returns empty)", () => {
    const { container } = renderTooltipWith({
      active: true,
      payload: [{
        dataKey: "solarToHome",
        value: 1,
        payload: {
          solarToHome: 1,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 0,
          gridToCar: 0,
          solarProduction: 0,
          totalConsumption: 0,
          gridToHomeCostCents: 0,
          gridToCarCostCents: 0,
          vehicleSoc: [],
        },
      }],
      label: "",
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders tooltip with flow data for day/1h period", () => {
    renderTooltipWith({
      active: true,
      label: "10",
      payload: [{
        dataKey: "solarToHome",
        value: 1.5,
        payload: {
          label: "10",
          solarToHome: 1.5,
          solarToCar: 0.5,
          solarToGrid: 0.3,
          gridToHome: 0.2,
          gridToCar: 0.1,
          solarProduction: 2.0,
          totalConsumption: 2.3,
          costCents: 50,
          gridToHomeCostCents: 30,
          gridToCarCostCents: 20,
          vehicleSoc: [],
        },
      }],
    });
    // Header shows hour range
    expect(screen.getByText("10:00 – 11:00")).toBeInTheDocument();
    // Flow rows
    expect(screen.getByText("Solar → Home")).toBeInTheDocument();
    expect(screen.getByText("1.50 kWh")).toBeInTheDocument();
    expect(screen.getByText("Grid → Home")).toBeInTheDocument();
    expect(screen.getByText("Grid → Car")).toBeInTheDocument();
  });

  it("renders tooltip with 15m resolution header", () => {
    renderTooltipWith({
      active: true,
      label: "10:30",
      payload: [{
        dataKey: "solarToHome",
        value: 1,
        payload: {
          label: "10:30",
          solarToHome: 1.0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 0.5,
          gridToCar: 0,
          solarProduction: 0,
          totalConsumption: 0,
          costCents: null,
          gridToHomeCostCents: 10,
          gridToCarCostCents: 0,
          vehicleSoc: [],
        },
      }],
    }, { resolution: "15m", bucketLabel: "10:30" });
    expect(screen.getByText("10:30 – 10:45")).toBeInTheDocument();
  });

  it("renders month period header", () => {
    renderTooltipWith({
      active: true,
      label: "15",
      payload: [{
        dataKey: "solarToHome",
        value: 1,
        payload: {
          solarToHome: 1.0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 0,
          gridToCar: 0,
          solarProduction: 0,
          totalConsumption: 0,
          gridToHomeCostCents: 0,
          gridToCarCostCents: 0,
          vehicleSoc: [],
        },
      }],
    }, { period: "month", bucketLabel: "15" });
    // March 15, 2026 is a Sunday
    expect(screen.getByText("Sun, Mar 15")).toBeInTheDocument();
  });

  it("renders year period header (month name passthrough)", () => {
    renderTooltipWith({
      active: true,
      label: "Mar",
      payload: [{
        dataKey: "solarToHome",
        value: 1,
        payload: {
          solarToHome: 1.0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 0,
          gridToCar: 0,
          solarProduction: 0,
          totalConsumption: 0,
          gridToHomeCostCents: 0,
          gridToCarCostCents: 0,
          vehicleSoc: [],
        },
      }],
    }, {
      period: "year",
      bucketLabel: "Mar",
      dateCursor: new Date(2026, 0, 1),
    });
    expect(screen.getByText("Mar")).toBeInTheDocument();
  });

  it("renders solar production and total consumption lines", () => {
    renderTooltipWith({
      active: true,
      label: "10",
      payload: [{
        dataKey: "solarToHome",
        value: 1,
        payload: {
          solarToHome: 1.0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 0,
          gridToCar: 0,
          solarProduction: 5.0,
          totalConsumption: 3.0,
          gridToHomeCostCents: 0,
          gridToCarCostCents: 0,
          vehicleSoc: [],
        },
      }],
    });
    expect(screen.getByText("Solar Production")).toBeInTheDocument();
    expect(screen.getByText("5.00 kWh")).toBeInTheDocument();
    expect(screen.getByText("Total Consumption")).toBeInTheDocument();
    expect(screen.getByText("3.00 kWh")).toBeInTheDocument();
  });

  it("hides zero-value flows", () => {
    renderTooltipWith({
      active: true,
      label: "10",
      payload: [{
        dataKey: "solarToHome",
        value: 0,
        payload: {
          solarToHome: 0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 1.0,
          gridToCar: 0,
          solarProduction: 0,
          totalConsumption: 0,
          gridToHomeCostCents: 50,
          gridToCarCostCents: 0,
          vehicleSoc: [],
        },
      }],
    });
    expect(screen.queryByText("Solar → Home")).not.toBeInTheDocument();
    expect(screen.getByText("Grid → Home")).toBeInTheDocument();
  });

  it("renders vehicle SoC section", () => {
    renderTooltipWith({
      active: true,
      label: "10",
      payload: [{
        dataKey: "solarToHome",
        value: 1,
        payload: {
          solarToHome: 1.0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 0,
          gridToCar: 0,
          solarProduction: 0,
          totalConsumption: 0,
          gridToHomeCostCents: 0,
          gridToCarCostCents: 0,
          vehicleSoc: [
            { vehicleId: "v1", vehicleName: "Model 3", batteryLevel: 75 },
          ],
        },
      }],
    });
    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("shows cost for grid flows when hasCostData is true", () => {
    renderTooltipWith({
      active: true,
      label: "10",
      payload: [{
        dataKey: "gridToHome",
        value: 2,
        payload: {
          solarToHome: 0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 2.0,
          gridToCar: 1.0,
          solarProduction: 0,
          totalConsumption: 0,
          gridToHomeCostCents: 150,
          gridToCarCostCents: 80,
          vehicleSoc: [],
        },
      }],
    });
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByText("$0.80")).toBeInTheDocument();
  });

  it("renders 15m resolution with minute rollover to next hour", () => {
    renderTooltipWith({
      active: true,
      label: "10:45",
      payload: [{
        dataKey: "solarToHome",
        value: 1,
        payload: {
          solarToHome: 1.0,
          solarToCar: 0,
          solarToGrid: 0,
          gridToHome: 0,
          gridToCar: 0,
          solarProduction: 0,
          totalConsumption: 0,
          gridToHomeCostCents: 0,
          gridToCarCostCents: 0,
          vehicleSoc: [],
        },
      }],
    }, { resolution: "15m", bucketLabel: "10:45" });
    // 10:45 + 15m = 11:00
    expect(screen.getByText("10:45 – 11:00")).toBeInTheDocument();
  });
});
