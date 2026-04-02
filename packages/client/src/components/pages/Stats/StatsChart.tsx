import { useCallback, useMemo } from "react";
import { Card, SegmentedControl, Text } from "@radix-ui/themes";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  StatsPeriod,
  StatsResponse,
  VehicleSocSnapshot,
} from "@chargeha/shared";
import type { DayResolution } from "../../../hooks/useStats.ts";
import { formatCost } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

const MONTH_ABBRS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

interface ChartDatum {
  label: string;
  solarToHome: number;
  solarToCar: number;
  solarToGrid: number;
  gridToHome: number;
  gridToCar: number;
  solarProduction: number;
  totalConsumption: number;
  costCents: number | null;
  gridToHomeCostCents: number;
  gridToCarCostCents: number;
  vehicleSoc: VehicleSocSnapshot[];
}

const FLOW_COLORS: Record<string, string> = {
  solarToHome: "var(--color-solar)",
  solarToCar: "var(--color-solar-car)",
  solarToGrid: "var(--color-grid-export)",
  gridToHome: "var(--color-grid-import)",
  gridToCar: "var(--color-grid-car)",
};

const TOOLTIP_NAMES: Record<string, string> = {
  solarToHome: "Solar \u2192 Home",
  solarToCar: "Solar \u2192 Car",
  solarToGrid: "Solar \u2192 Grid",
  gridToHome: "Grid \u2192 Home",
  gridToCar: "Grid \u2192 Car",
  solarProduction: "Solar Production",
  totalConsumption: "Total Consumption",
};

// Flow keys in stacking order (bottom to top), excluding the line
const FLOW_KEYS = [
  "solarToHome",
  "solarToCar",
  "solarToGrid",
  "gridToHome",
  "gridToCar",
] as const;

/** Build a time-range header label for the tooltip. */
function buildHeaderLabel(
  label: string,
  period: StatsPeriod,
  resolution: DayResolution,
  cursor: Date,
): string {
  if (period === "day") {
    if (!label) return "";
    const hour = parseInt(label, 10);
    if (resolution === "15m") {
      // Labels are now "HH:MM" — show the 15-minute range
      const [hh, mm] = label.split(":");
      const startMin = parseInt(mm, 10);
      const endMin = startMin + 15;
      const endHour = endMin >= 60 ? parseInt(hh, 10) + 1 : parseInt(hh, 10);
      const endMinStr = String(endMin % 60).padStart(2, "0");
      return `${hh}:${mm} \u2013 ${
        String(endHour).padStart(2, "0")
      }:${endMinStr}`;
    }
    const end = hour + 1;
    return `${String(hour).padStart(2, "0")}:00 \u2013 ${
      String(end).padStart(2, "0")
    }:00`;
  }
  if (period === "month") {
    const day = parseInt(label, 10);
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  // year: label is already a month name
  return label;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; payload: ChartDatum }>;
  label?: string;
  period: StatsPeriod;
  resolution: DayResolution;
  dateCursor: Date;
  currencySymbol: string;
  hasCostData: boolean;
}

function CustomTooltip({
  active,
  payload,
  label,
  period,
  resolution,
  dateCursor,
  currencySymbol,
  hasCostData,
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const datum = payload[0]?.payload;
  if (!datum) return null;

  const headerLabel = buildHeaderLabel(
    label ?? "",
    period,
    resolution,
    dateCursor,
  );
  if (!headerLabel) return null;

  // Cost map: flow key → cost cents (only grid flows have cost)
  const costMap: Record<string, number> = {
    gridToHome: datum.gridToHomeCostCents,
    gridToCar: datum.gridToCarCostCents,
  };

  // Show cost column when there's cost data for the dataset
  const showCost = hasCostData;

  return (
    <div className={styles.customTooltip}>
      <div className={styles.tooltipHeader}>{headerLabel}</div>
      {FLOW_KEYS.map((key) => {
        const value = datum[key];
        if (value === 0) return null;
        const cost = costMap[key];
        const isGridFlow = key === "gridToHome" || key === "gridToCar";
        return (
          <div key={key} className={styles.tooltipRow}>
            <span
              className={styles.tooltipSwatch}
              style={{ backgroundColor: FLOW_COLORS[key] }}
            />
            <span className={styles.tooltipLabel}>
              {TOOLTIP_NAMES[key]}
            </span>
            <span className={styles.tooltipValue}>
              {value.toFixed(2)} kWh
            </span>
            {showCost && (
              <span className={styles.tooltipCost}>
                {isGridFlow ? formatCost(cost ?? 0, currencySymbol) : ""}
              </span>
            )}
          </div>
        );
      })}
      {datum.solarProduction > 0 && (
        <div className={styles.tooltipRow}>
          <span
            className={styles.tooltipLine}
            style={{ backgroundColor: "var(--color-solar-production)" }}
          />
          <span className={styles.tooltipLabel}>
            {TOOLTIP_NAMES.solarProduction}
          </span>
          <span className={styles.tooltipValue}>
            {datum.solarProduction.toFixed(2)} kWh
          </span>
          {showCost && <span className={styles.tooltipCost} />}
        </div>
      )}
      {datum.totalConsumption > 0 && (
        <div className={styles.tooltipRow}>
          <span
            className={styles.tooltipLine}
            style={{ backgroundColor: "var(--color-consumption)" }}
          />
          <span className={styles.tooltipLabel}>
            {TOOLTIP_NAMES.totalConsumption}
          </span>
          <span className={styles.tooltipValue}>
            {datum.totalConsumption.toFixed(2)} kWh
          </span>
          {showCost && <span className={styles.tooltipCost} />}
        </div>
      )}
      {datum.vehicleSoc.length > 0 && (
        <>
          <div className={styles.tooltipDivider} />
          {datum.vehicleSoc.map((v) => (
            <div key={v.vehicleId} className={styles.tooltipRow}>
              <span className={styles.tooltipSocIcon}>🔋</span>
              <span className={styles.tooltipLabel}>{v.vehicleName}</span>
              <span className={styles.tooltipValue}>{v.batteryLevel}%</span>
              {showCost && <span className={styles.tooltipCost} />}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

interface StatsChartProps {
  data: StatsResponse | null;
  loading: boolean;
  period: StatsPeriod;
  resolution: DayResolution;
  setResolution: (r: DayResolution) => void;
  dateCursor: Date;
  onDrillDown: (period: StatsPeriod, date: Date) => void;
}

function computeTickInterval(
  period: StatsPeriod,
  resolution: DayResolution,
): number {
  if (period === "day") return resolution === "15m" ? 11 : 2;
  if (period === "month") return 4;
  return 0;
}

function useChartClickHandler(
  period: StatsPeriod,
  dateCursor: Date,
  onDrillDown: (period: StatsPeriod, date: Date) => void,
) {
  return useCallback((e: { activeLabel?: string }) => {
    if (!e?.activeLabel) return;
    if (period === "month") {
      const day = parseInt(e.activeLabel, 10);
      if (!isNaN(day)) {
        onDrillDown(
          "day",
          new Date(dateCursor.getFullYear(), dateCursor.getMonth(), day),
        );
      }
    } else if (period === "year") {
      const monthIndex = MONTH_ABBRS.indexOf(e.activeLabel);
      if (monthIndex >= 0) {
        onDrillDown("month", new Date(dateCursor.getFullYear(), monthIndex, 1));
      }
    }
  }, [period, dateCursor, onDrillDown]);
}

function buildBucketDatum(
  eb: NonNullable<StatsChartProps["data"]>["energyBuckets"][number],
  cb: NonNullable<StatsChartProps["data"]>["buckets"][number] | undefined,
  period: StatsPeriod,
  resolution: DayResolution,
  vehicleSoc: ChartDatum["vehicleSoc"] | undefined,
): ChartDatum {
  const solarToCar = Math.round(((cb?.solarWh ?? 0) / 1000) * 100) / 100;
  const solarToHome = Math.round(
    (Math.max(0, eb.solarWh - (cb?.solarWh ?? 0)) / 1000) * 100,
  ) / 100;
  const gridToCar = Math.round(((cb?.gridWh ?? 0) / 1000) * 100) / 100;
  const gridToHome = Math.round(
    (Math.max(0, eb.gridWh - (cb?.gridWh ?? 0)) / 1000) * 100,
  ) / 100;
  const solarProduction = Math.round((eb.solarProductionWh / 1000) * 100) / 100;
  const solarToGrid = Math.round(
    Math.max(0, solarProduction - solarToHome - solarToCar) * 100,
  ) / 100;
  const energyCost = eb.costCents ?? 0;
  const chargeCost = cb?.costCents ?? 0;
  const gridToCarCostCents = chargeCost;
  const gridToHomeCostCents = Math.max(0, energyCost - chargeCost);
  const totalConsumption = Math.round(
    (solarToHome + solarToCar + gridToHome + gridToCar) * 100,
  ) / 100;
  return {
    label: period === "day" && resolution !== "15m"
      ? `${eb.label}:00`
      : eb.label,
    solarToHome,
    solarToCar,
    solarToGrid,
    gridToHome,
    gridToCar,
    solarProduction,
    totalConsumption,
    costCents: cb?.costCents ?? null,
    gridToHomeCostCents,
    gridToCarCostCents,
    vehicleSoc: vehicleSoc ?? [],
  };
}

function ChartLegend() {
  return (
    <div className={styles.legend}>
      <span className={styles.legendItem}>
        <span
          className={styles.legendSwatch}
          style={{ backgroundColor: "var(--color-solar)" }}
        />
        Solar → Home
      </span>
      <span className={styles.legendItem}>
        <span
          className={styles.legendSwatch}
          style={{ backgroundColor: "var(--color-solar-car)" }}
        />
        Solar → Car
      </span>
      <span className={styles.legendItem}>
        <span
          className={styles.legendSwatch}
          style={{ backgroundColor: "var(--color-grid-export)" }}
        />
        Solar → Grid
      </span>
      <span className={styles.legendItem}>
        <span
          className={styles.legendSwatch}
          style={{ backgroundColor: "var(--color-grid-import)" }}
        />
        Grid → Home
      </span>
      <span className={styles.legendItem}>
        <span
          className={styles.legendSwatch}
          style={{ backgroundColor: "var(--color-grid-car)" }}
        />
        Grid → Car
      </span>
      <span className={styles.legendItem}>
        <span
          className={styles.legendLine}
          style={{ backgroundColor: "var(--color-solar-production)" }}
        />
        Solar Production
      </span>
      <span className={styles.legendItem}>
        <span
          className={styles.legendLineDashed}
          style={{ backgroundColor: "var(--color-consumption)" }}
        />
        Total Consumption
      </span>
    </div>
  );
}

/** Returns the recharts Bar/Line elements for ComposedChart. Called as a
 *  function (not JSX) so the fragment lands directly in ComposedChart's
 *  children — recharts walks `Children.map` to find Bar/Line by displayName,
 *  and a wrapper component (e.g. `<ChartBars />`) hides them and the chart
 *  renders blank. */
function chartBars() {
  return (
    <>
      <Bar
        dataKey="solarToHome"
        stackId="energy"
        fill="var(--color-solar)"
        name="solarToHome"
      />
      <Bar
        dataKey="solarToCar"
        stackId="energy"
        fill="var(--color-solar-car)"
        name="solarToCar"
      />
      <Bar
        dataKey="solarToGrid"
        stackId="energy"
        fill="var(--color-grid-export)"
        name="solarToGrid"
      />
      <Bar
        dataKey="gridToHome"
        stackId="energy"
        fill="var(--color-grid-import)"
        name="gridToHome"
      />
      <Bar
        dataKey="gridToCar"
        stackId="energy"
        fill="var(--color-grid-car)"
        name="gridToCar"
        radius={[2, 2, 0, 0]}
      />
      <Line
        dataKey="solarProduction"
        name="solarProduction"
        type="monotone"
        stroke="var(--color-solar-production)"
        strokeWidth={2.5}
        dot={false}
      />
      <Line
        dataKey="totalConsumption"
        name="totalConsumption"
        type="monotone"
        stroke="var(--color-consumption)"
        strokeWidth={2.5}
        strokeDasharray="6 3"
        dot={false}
      />
    </>
  );
}

export function StatsChart({
  data,
  loading,
  period,
  resolution,
  setResolution,
  dateCursor,
  onDrillDown,
}: StatsChartProps) {
  const currencySymbol = data?.currencySymbol ?? "$";
  // Show cost column when any cost data exists — vehicle charging OR home energy
  const hasTotalCost = (data?.totalCostCents ?? 0) > 0;
  const hasSavings = (data?.solarSavingsCents ?? 0) > 0;
  const hasBucketCost =
    data?.energyBuckets?.some((b) => (b.costCents ?? 0) > 0) ?? false;
  const hasCostData = hasTotalCost || hasSavings || hasBucketCost;

  const chartData: ChartDatum[] = useMemo(() => {
    if (!data) return [];
    return data.energyBuckets.map((eb, i) =>
      buildBucketDatum(
        eb,
        data.buckets[i],
        period,
        resolution,
        data.vehicleSoc?.[i],
      )
    );
  }, [data]);

  // Determine X-axis tick display — show every Nth label on dense axes
  // Day 15m: 96 buckets, show every 12th (every 3 hours)
  // Day 1h: 24 buckets, show every 2nd
  // Month view: 28-31 buckets, show every 5th
  // Year view: 12 buckets, show all
  const tickInterval = computeTickInterval(period, resolution);
  const canDrillDown = period === "month" || period === "year";
  const handleChartClick = useChartClickHandler(
    period,
    dateCursor,
    onDrillDown,
  );

  return (
    <Card className={styles.chartCard}>
      {/* Resolution toggle — day view only */}
      {period === "day" && (
        <div className={styles.resolutionToggle}>
          <SegmentedControl.Root
            value={resolution}
            onValueChange={(v) => setResolution(v as DayResolution)}
            size="1"
          >
            <SegmentedControl.Item value="1h">1h</SegmentedControl.Item>
            <SegmentedControl.Item value="15m">15m</SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>
      )}
      <div className={styles.chartWrapper}>
        {loading && (
          <div className={styles.chartPlaceholder}>
            <Text color="gray">Loading…</Text>
          </div>
        )}
        {!loading && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              onClick={canDrillDown ? handleChartClick : undefined}
              style={canDrillDown ? { cursor: "pointer" } : undefined}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                interval={tickInterval}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => `${v} kWh`}
                width={70}
              />
              <Tooltip
                content={
                  <CustomTooltip
                    period={period}
                    resolution={resolution}
                    dateCursor={dateCursor}
                    currencySymbol={currencySymbol}
                    hasCostData={hasCostData}
                  />
                }
              />
              {chartBars()}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <ChartLegend />
    </Card>
  );
}
