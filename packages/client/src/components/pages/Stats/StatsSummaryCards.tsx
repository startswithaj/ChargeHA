import { Card, Text, Tooltip } from "@radix-ui/themes";
import type { StatsResponse } from "@chargeha/shared";
import { formatCost, formatRate, kwhValue } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

interface StatsSummaryCardsProps {
  data: StatsResponse | null;
  loading: boolean;
}

function CostBreakdownContent(
  {
    tariffBreakdown,
    currencySymbol,
    evGridCostCents,
    evGridWh,
    homeGridCostCents,
    homeGridWh,
  }: {
    tariffBreakdown: StatsResponse["tariffBreakdown"] | undefined;
    currencySymbol: string;
    evGridCostCents: number;
    evGridWh: number;
    homeGridCostCents: number;
    homeGridWh: number;
  },
) {
  if (tariffBreakdown && tariffBreakdown.length > 0) {
    return (
      <>
        {tariffBreakdown.map((entry) => (
          <span key={entry.ratePerKwh} style={{ display: "block" }}>
            {entry.label}: {kwhValue(entry.gridWh)} —{" "}
            {formatCost(entry.costCents, currencySymbol)}{" "}
            ({formatRate(entry.ratePerKwh, currencySymbol)}/kWh)
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {evGridCostCents > 0 && (
        <span style={{ display: "block" }}>
          EV: {kwhValue(evGridWh)} —{" "}
          {formatCost(evGridCostCents, currencySymbol)}
        </span>
      )}
      {homeGridCostCents > 0 && (
        <span style={{ display: "block" }}>
          Home: {kwhValue(homeGridWh)} —{" "}
          {formatCost(homeGridCostCents, currencySymbol)}
        </span>
      )}
    </>
  );
}

function buildCostTooltip(
  {
    data,
    tariffBreakdown,
    currencySymbol,
    evGridCostCents,
    evGridWh,
    homeGridCostCents,
    homeGridWh,
    solarSavingsCents,
  }: {
    data: StatsResponse;
    tariffBreakdown: StatsResponse["tariffBreakdown"] | undefined;
    currencySymbol: string;
    evGridCostCents: number;
    evGridWh: number;
    homeGridCostCents: number;
    homeGridWh: number;
    solarSavingsCents: number;
  },
) {
  const solarLabel = solarSavingsCents > 0
    ? `saved ${formatCost(solarSavingsCents, currencySymbol)}`
    : "free";
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 13,
      }}
    >
      <CostBreakdownContent
        tariffBreakdown={tariffBreakdown}
        currencySymbol={currencySymbol}
        evGridCostCents={evGridCostCents}
        evGridWh={evGridWh}
        homeGridCostCents={homeGridCostCents}
        homeGridWh={homeGridWh}
      />
      <span
        style={{
          display: "block",
          borderTop: "1px solid rgba(255,255,255,0.2)",
          paddingTop: 4,
          marginTop: 2,
        }}
      >
        Solar: {kwhValue(data.homeSolarWh ?? 0)} — {solarLabel}
      </span>
    </span>
  );
}

function buildSavingsTooltip(
  { data, currencySymbol, evSolarSavingsCents, homeSolarSavingsCents }: {
    data: StatsResponse;
    currencySymbol: string;
    evSolarSavingsCents: number;
    homeSolarSavingsCents: number;
  },
) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 13,
      }}
    >
      {evSolarSavingsCents > 0 && (
        <span style={{ display: "block" }}>
          EV: {kwhValue(data.totalSolarWh ?? 0)} —{" "}
          {formatCost(evSolarSavingsCents, currencySymbol)}
        </span>
      )}
      {homeSolarSavingsCents > 0 && (
        <span style={{ display: "block" }}>
          Home: {kwhValue((data.homeSolarWh ?? 0) - (data.totalSolarWh ?? 0))} —
          {" "}
          {formatCost(homeSolarSavingsCents, currencySymbol)}
        </span>
      )}
    </span>
  );
}

function SummaryCard(
  { label, value }: { label: string; value: React.ReactNode },
) {
  return (
    <Card className={styles.summaryCard}>
      <Text size="2" color="gray">{label}</Text>
      <span className={styles.summaryValue}>{value}</span>
    </Card>
  );
}

export function StatsSummaryCards({ data, loading }: StatsSummaryCardsProps) {
  const currencySymbol = data?.currencySymbol ?? "$";

  // Total home energy grid cost (includes home + car grid consumption)
  const bucketCostSum = data?.energyBuckets?.reduce(
    (s, b) => s + (b.costCents ?? 0),
    0,
  );
  const totalEnergyCostCents = bucketCostSum ?? 0;
  const hasEnergyCost = totalEnergyCostCents > 0;

  // Vehicle charging cost data
  const hasChargingCost = (data?.totalCostCents ?? 0) > 0 ||
    (data?.solarSavingsCents ?? 0) > 0;

  const hasCostData = hasEnergyCost || hasChargingCost;

  const tariffBreakdown = data?.tariffBreakdown;

  const evGridCostCents = data?.totalCostCents ?? 0;
  const homeGridCostCents = Math.max(0, totalEnergyCostCents - evGridCostCents);
  const evGridWh = data?.totalGridWh ?? 0;
  const homeGridWh = (data?.homeGridWh ?? 0) - evGridWh;
  const evSolarSavingsCents = data?.evSolarSavingsCents ?? 0;
  const homeSolarSavingsCents = Math.max(
    0,
    (data?.solarSavingsCents ?? 0) - evSolarSavingsCents,
  );

  const costTooltip = makeCostTooltip();
  const savingsTooltip = makeSavingsTooltip();

  function makeCostTooltip() {
    if (!hasCostData || !data) return null;
    return buildCostTooltip({
      data,
      tariffBreakdown,
      currencySymbol,
      evGridCostCents,
      evGridWh,
      homeGridCostCents,
      homeGridWh,
      solarSavingsCents: data.solarSavingsCents ?? 0,
    });
  }

  function makeSavingsTooltip() {
    if (!hasChargingCost || !data) return null;
    return buildSavingsTooltip({
      data,
      currencySymbol,
      evSolarSavingsCents,
      homeSolarSavingsCents,
    });
  }

  return (
    <>
      <div className={styles.summary}>
        <SummaryCard
          label="Solar Produced"
          value={loading ? "—" : kwhValue(data?.homeSolarProductionWh ?? 0)}
        />
        <SummaryCard
          label="Total Consumed"
          value={loading ? "—" : kwhValue(data?.homeConsumedWh ?? 0)}
        />
        <SummaryCard
          label="Self Powered"
          value={loading ? "—" : `${data?.homeSelfPoweredPercent ?? 0}%`}
        />
      </div>

      {/* Cost summary cards — only when tariff data exists */}
      {hasCostData && (
        <div className={styles.costSummary}>
          <Tooltip content={costTooltip} delayDuration={200}>
            <Card className={styles.summaryCard} style={{ cursor: "default" }}>
              <Text size="2" color="gray">
                Grid Cost
              </Text>
              <span className={styles.summaryValue}>
                {formatCost(totalEnergyCostCents, currencySymbol)}
              </span>
            </Card>
          </Tooltip>
          {hasChargingCost && (
            <Tooltip content={savingsTooltip} delayDuration={200}>
              <Card
                className={styles.summaryCard}
                style={{ cursor: "default" }}
              >
                <Text size="2" color="gray">
                  Solar Savings
                </Text>
                <span className={styles.summaryValue}>
                  {formatCost(data?.solarSavingsCents ?? 0, currencySymbol)}
                </span>
              </Card>
            </Tooltip>
          )}
        </div>
      )}
    </>
  );
}
