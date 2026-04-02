import { DollarSign, MapPin, Sun, Zap } from "lucide-react";
import { Card, Text } from "@radix-ui/themes";
import type { StatsPeriod, StatsResponse } from "@chargeha/shared";
import type { DayResolution } from "../../../hooks/useStats.ts";
import {
  useVehicleBreakdowns,
  type VehicleBreakdown,
} from "../../../hooks/useVehicleBreakdowns.ts";
import { formatCost, kwhValue } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

interface StatsVehicleBreakdownProps {
  data: StatsResponse | null;
  loading: boolean;
  period: StatsPeriod;
  cursor: Date;
  resolution: DayResolution;
}

/** Renders a single vehicle charging card matching the "Vehicle Charging" layout. */
function VehicleChargingCard({
  title,
  totalChargedWh,
  solarWh,
  gridWh,
  awayWh,
  costCents,
  evSolarSavingsCents,
  currencySymbol,
}: {
  title: string;
  totalChargedWh: number;
  solarWh: number;
  gridWh: number;
  awayWh?: number;
  costCents?: number;
  evSolarSavingsCents?: number;
  currencySymbol: string;
}) {
  const homeTotal = solarWh + gridWh;
  const solarPct = homeTotal > 0 ? Math.round((solarWh / homeTotal) * 100) : 0;
  const gridPct = homeTotal > 0 ? Math.round((gridWh / homeTotal) * 100) : 0;
  const hasCost = (costCents ?? 0) > 0 || (evSolarSavingsCents ?? 0) > 0;

  return (
    <Card className={styles.breakdownCard}>
      <Text size="2" weight="bold">
        {title}
      </Text>
      <div className={styles.breakdownRow}>
        <Text size="2" color="gray" className={styles.breakdownLabel}>
          Total Charged
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(totalChargedWh)}
        </Text>
        <Text size="2" className={styles.breakdownPct} />
      </div>
      <div className={styles.breakdownRow}>
        <div
          className={styles.breakdownIcon}
          style={{ backgroundColor: "var(--color-solar-car)" }}
        />
        <Sun size={16} style={{ color: "var(--color-solar-car)" }} />
        <Text size="2" className={styles.breakdownLabel}>
          From Solar
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(solarWh)}
        </Text>
        <Text size="2" color="gray" className={styles.breakdownPct}>
          {solarPct}%
        </Text>
      </div>
      <div className={styles.breakdownRow}>
        <div
          className={styles.breakdownIcon}
          style={{ backgroundColor: "var(--color-grid-car)" }}
        />
        <Zap size={16} style={{ color: "var(--color-grid-car)" }} />
        <Text size="2" className={styles.breakdownLabel}>
          From Grid
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(gridWh)}
        </Text>
        <Text size="2" color="gray" className={styles.breakdownPct}>
          {gridPct}%
        </Text>
      </div>
      {awayWh != null && awayWh > 0 && (
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "var(--color-away)" }}
          />
          <MapPin size={16} style={{ color: "var(--color-away)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Away
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(awayWh)}
          </Text>
          <Text size="2" color="gray" className={styles.breakdownPct}>
            {totalChargedWh > 0
              ? `${Math.round((awayWh / totalChargedWh) * 100)}%`
              : "0%"}
          </Text>
        </div>
      )}
      {hasCost && (
        <>
          <div className={styles.breakdownRow}>
            <div
              className={styles.breakdownIcon}
              style={{ backgroundColor: "transparent" }}
            />
            <DollarSign size={16} style={{ color: "var(--gray-11)" }} />
            <Text size="2" className={styles.breakdownLabel}>
              Cost
            </Text>
            <Text size="2" className={styles.breakdownValue}>
              {formatCost(costCents ?? 0, currencySymbol)}
            </Text>
            <Text size="2" className={styles.breakdownPct} />
          </div>
          {(evSolarSavingsCents ?? 0) > 0 && (
            <div className={styles.breakdownRow}>
              <div
                className={styles.breakdownIcon}
                style={{ backgroundColor: "transparent" }}
              />
              <Sun size={16} style={{ color: "var(--color-solar-car)" }} />
              <Text size="2" className={styles.breakdownLabel}>
                Solar Savings
              </Text>
              <Text size="2" color="green" className={styles.breakdownValue}>
                {formatCost(evSolarSavingsCents ?? 0, currencySymbol)}
              </Text>
              <Text size="2" className={styles.breakdownPct} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function StatsVehicleBreakdown(
  { data, loading, period, cursor, resolution }: StatsVehicleBreakdownProps,
) {
  const {
    hasChargeData,
    hasConfiguredVehicles,
    vehicleBreakdownsLoading,
    currencySymbol,
    gridPercent,
    activeVehicleBreakdowns,
  } = useVehicleBreakdowns({ data, loading, period, cursor, resolution });

  return (
    <>
      {/* Energy source breakdown */}
      <Card className={styles.breakdownCard}>
        <Text size="2" weight="bold">
          Energy Sources
        </Text>
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "var(--color-solar)" }}
          />
          <Sun size={16} style={{ color: "var(--color-solar)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            From Solar
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeSolarWh ?? 0)}
          </Text>
          <Text size="2" color="gray" className={styles.breakdownPct}>
            {data?.homeSelfPoweredPercent ?? 0}%
          </Text>
        </div>
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "var(--color-grid-import)" }}
          />
          <Zap size={16} style={{ color: "var(--color-grid-import)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            From Grid
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeGridWh ?? 0)}
          </Text>
          <Text size="2" color="gray" className={styles.breakdownPct}>
            {gridPercent}%
          </Text>
        </div>
      </Card>

      {/* Per-vehicle charging cards — one card per vehicle */}
      {hasChargeData && activeVehicleBreakdowns.length > 0 &&
        activeVehicleBreakdowns.map((vb: VehicleBreakdown) => (
          <VehicleChargingCard
            key={vb.vehicleId}
            title={vb.vehicleName}
            totalChargedWh={vb.totalChargedWh}
            solarWh={vb.totalSolarWh}
            gridWh={vb.totalGridWh}
            costCents={vb.totalCostCents}
            evSolarSavingsCents={vb.evSolarSavingsCents}
            currencySymbol={currencySymbol}
          />
        ))}
      {hasChargeData &&
        !vehicleBreakdownsLoading &&
        !hasConfiguredVehicles &&
        activeVehicleBreakdowns.length === 0 && (
        <VehicleChargingCard
          title="Vehicle Charging"
          totalChargedWh={data?.totalChargedWh ?? 0}
          solarWh={data?.totalSolarWh ?? 0}
          gridWh={data?.totalGridWh ?? 0}
          awayWh={data?.totalAwayWh ?? 0}
          costCents={data?.totalCostCents ?? 0}
          evSolarSavingsCents={data?.evSolarSavingsCents ?? 0}
          currencySymbol={currencySymbol}
        />
      )}
    </>
  );
}
