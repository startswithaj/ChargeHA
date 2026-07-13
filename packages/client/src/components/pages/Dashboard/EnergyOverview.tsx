import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Battery,
  Calendar,
  Car,
  DollarSign,
  Home,
  PlugZap,
  Sun,
} from "lucide-react";
import { Card, Text } from "@radix-ui/themes";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";
import { EnergyFlowDiagram } from "../../EnergyFlowDiagram/EnergyFlowDiagram.tsx";
import { MetricCard } from "../../MetricCard/MetricCard.tsx";
import { kwhValue, kwValue } from "../../../utils/Format.ts";
import { trpc } from "../../../trpc.ts";
import { formatTimeUntil, useChargingVehicleFlows } from "./energyHelpers.ts";
import styles from "./Dashboard.module.css";

interface PluginWarning {
  title: string;
  message: string;
}

interface EnergyOverviewProps {
  pluginWarnings: PluginWarning[];
}

function PluginWarningCard({ warning }: { warning: PluginWarning }) {
  return (
    <Card style={{ borderLeft: "3px solid var(--orange-9)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AlertTriangle
          size={20}
          style={{ color: "var(--orange-9)", flexShrink: 0 }}
        />
        <div>
          <Text size="2" weight="bold" style={{ display: "block" }}>
            {warning.title}
          </Text>
          <Text size="2" color="gray">{warning.message}</Text>
        </div>
      </div>
    </Card>
  );
}

function MetricSection(
  { label, children }: { label: string; children: React.ReactNode },
) {
  return (
    <div className={styles.metricsSection}>
      <Text
        size="1"
        color="gray"
        weight="medium"
        className={styles.metricsSectionLabel}
      >
        {label}
      </Text>
      <div className={styles.metricsRow}>{children}</div>
    </div>
  );
}

function StatusSection(
  {
    hasBattery,
    realtime,
    currentRate,
    currentRateValue,
    currentRateSubtitle,
    activeScheduleLines,
    loading,
  }: {
    hasBattery: boolean;
    realtime:
      | {
        batteryPowerW: number | null | undefined;
        batterySoc: number | null;
      }
      | null;
    currentRate: { label: string } | null;
    currentRateValue: string;
    currentRateSubtitle: string | undefined;
    activeScheduleLines: string[] | null;
    loading: boolean;
  },
) {
  return (
    <MetricSection label="Status">
      {hasBattery && realtime && (
        <MetricCard
          icon={<Battery size={20} />}
          label="Battery"
          value={kwValue(Math.abs(realtime.batteryPowerW ?? 0))}
          accentColor="var(--color-battery)"
          loading={loading}
          subtitle={realtime.batterySoc !== null
            ? `${Math.round(realtime.batterySoc)}% charged`
            : undefined}
        />
      )}
      {currentRate && (
        <MetricCard
          icon={<DollarSign size={20} />}
          label={`Tariff - ${currentRate.label}`}
          value={currentRateValue}
          accentColor="var(--color-grid-import)"
          subtitle={currentRateSubtitle}
        />
      )}
      <MetricCard
        icon={<Calendar size={20} />}
        label={activeScheduleLines && activeScheduleLines.length > 1
          ? "Active Schedules"
          : "Active Schedule"}
        value={activeScheduleLines?.join("\n") ?? "None"}
        accentColor={activeScheduleLines ? "var(--orange-9)" : "var(--gray-9)"}
        smallValue
      />
    </MetricSection>
  );
}

function useOverviewData() {
  const { data: energyData, isLoading: loading } = useEnergyData();
  const realtime = energyData?.realtime ?? null;
  const cumulative = energyData?.cumulative ?? null;
  const { vehicles } = useVehicles();

  const today = new Date().toISOString().slice(0, 10);
  const tz = -(new Date().getTimezoneOffset() / 60);
  const { data: statsDay = null } = trpc.stats.day.useQuery(
    { date: today, tz },
    { refetchInterval: 60_000 },
  );
  const { data: currentRate = null } = trpc.tariff.currentRate.useQuery(
    undefined,
    { refetchInterval: 10_000 },
  );
  const { data: activeSchedules = [] } = trpc.schedule.active.useQuery(
    undefined,
    { refetchInterval: 30_000 },
  );

  const chargingVehicles = useChargingVehicleFlows(realtime, vehicles);
  const hasBattery = realtime?.batteryPowerW !== null &&
    realtime?.batteryPowerW !== undefined;

  const activeScheduleLines = useMemo(() => {
    if (activeSchedules.length === 0) return null;
    return activeSchedules.map((s) => {
      const type = s.scheduleType === "blockout" ? "Blockout" : "Charge";
      const vehicleName = s.vehicleId
        ? vehicles.find((v) => v.id === s.vehicleId)?.name ?? "Vehicle"
        : "All vehicles";
      return `${type} ${s.startTime}-${s.endTime} · ${vehicleName}`;
    });
  }, [activeSchedules, vehicles]);

  const currentRateValue = formatCurrentRateValue(currentRate);

  const dailySolar = cumulative?.dailySolarProducedWh ?? 0;
  const dailyImport = cumulative?.dailyGridImportWh ?? 0;
  const dailyExport = cumulative?.dailyGridExportWh ?? 0;
  const dailyConsumed = dailySolar + dailyImport - dailyExport;

  const currentRateSubtitle = useMemo(
    () => formatCurrentRateSubtitle(currentRate),
    [currentRate],
  );

  return {
    loading,
    realtime,
    chargingVehicles,
    hasBattery,
    statsDay,
    currentRate,
    activeScheduleLines,
    currentRateValue,
    currentRateSubtitle,
    dailySolar,
    dailyImport,
    dailyExport,
    dailyConsumed,
  };
}

function formatCurrentRateValue(
  currentRate:
    | { currencySymbol?: string; ratePerKwh: number }
    | null,
): string {
  if (!currentRate) return "";
  const sym = currentRate.currencySymbol ?? "$";
  const rateStr = currentRate.ratePerKwh === Math.round(currentRate.ratePerKwh)
    ? currentRate.ratePerKwh.toFixed(2)
    : currentRate.ratePerKwh.toFixed(4);
  return `${sym}${rateStr}/kWh`;
}

function formatCurrentRateSubtitle(
  currentRate:
    | {
      currencySymbol?: string;
      nextRate?: { label: string; ratePerKwh: number; startsAt: string } | null;
    }
    | null,
): string | undefined {
  if (!currentRate?.nextRate) return undefined;
  const sym = currentRate.currencySymbol ?? "$";
  const nextRate = currentRate.nextRate.ratePerKwh;
  const nextRateStr = nextRate === Math.round(nextRate)
    ? nextRate.toFixed(2)
    : nextRate.toFixed(4);
  return `Next: ${currentRate.nextRate.label} (${sym}${nextRateStr}) in ${
    formatTimeUntil(currentRate.nextRate.startsAt)
  }`;
}

export function EnergyOverview({ pluginWarnings }: EnergyOverviewProps) {
  const {
    loading,
    realtime,
    chargingVehicles,
    hasBattery,
    statsDay,
    currentRate,
    activeScheduleLines,
    currentRateValue,
    currentRateSubtitle,
    dailySolar,
    dailyImport,
    dailyExport,
    dailyConsumed,
  } = useOverviewData();

  return (
    <>
      <EnergyFlowDiagram
        data={realtime}
        loading={loading}
        chargingVehicles={chargingVehicles}
      />

      {realtime?.pollFailed && (
        <PluginWarningCard
          warning={{
            title: "Energy source offline",
            message: realtime.pollError ??
              "Energy data poll failed — see the Logs page for details.",
          }}
        />
      )}

      {pluginWarnings.map((warning) => (
        <PluginWarningCard key={warning.title} warning={warning} />
      ))}

      <MetricSection label="Solar">
        <MetricCard
          icon={<Sun size={20} />}
          label="Solar Generated"
          value={kwhValue(dailySolar)}
          accentColor="var(--color-solar)"
          loading={loading}
        />
        <MetricCard
          icon={<Home size={20} />}
          label="Home Consumed"
          value={kwhValue(dailyConsumed)}
          accentColor="var(--color-home)"
          loading={loading}
        />
      </MetricSection>

      <MetricSection label="EV Charging">
        <MetricCard
          icon={<Car size={20} />}
          label="Charged Today"
          value={kwhValue(statsDay?.totalChargedWh ?? 0)}
          accentColor="var(--color-charging)"
          loading={loading}
        />
        <MetricCard
          icon={<PlugZap size={20} />}
          label="Solar to EVs"
          value={kwhValue(statsDay?.totalSolarWh ?? 0)}
          accentColor="var(--color-charging)"
          loading={loading}
        />
      </MetricSection>

      <MetricSection label="Grid">
        <MetricCard
          icon={<ArrowDownToLine size={20} />}
          label="Grid Import"
          value={kwhValue(dailyImport)}
          accentColor="var(--color-grid-import)"
          loading={loading}
        />
        <MetricCard
          icon={<ArrowUpFromLine size={20} />}
          label="Grid Export"
          value={kwhValue(dailyExport)}
          accentColor="var(--color-grid-export)"
          loading={loading}
        />
      </MetricSection>

      {(hasBattery || currentRate || activeScheduleLines) && (
        <StatusSection
          hasBattery={hasBattery}
          realtime={realtime}
          currentRate={currentRate}
          currentRateValue={currentRateValue}
          currentRateSubtitle={currentRateSubtitle}
          activeScheduleLines={activeScheduleLines}
          loading={loading}
        />
      )}
    </>
  );
}
