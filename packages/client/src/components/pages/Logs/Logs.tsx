import { useEffect, useMemo, useState } from "react";
import { Tabs, Text } from "@radix-ui/themes";
import type { VehicleWithState } from "@chargeha/shared";
import { useControllerLogs } from "../../../hooks/useControllerLogs.ts";
import { useEnergyReadings } from "../../../hooks/useEnergyReadings.ts";
import { useVehicleUpdates } from "../../../hooks/useVehicleUpdates.ts";
import { usePluginLogs } from "../../../hooks/usePluginLogs.ts";
import { trpc } from "../../../trpc.ts";
import { LogFilterBar } from "./LogFilterBar.tsx";
import { LogTable } from "./LogTable.tsx";
import { SimpleFilterBar } from "./SimpleFilterBar.tsx";
import { EnergyReadsTable } from "./EnergyReadsTable.tsx";
import { VehicleUpdatesTable } from "./VehicleUpdatesTable.tsx";
import { PluginLogsTable } from "./PluginLogsTable.tsx";
import { useStoredState } from "../../../lib/storage.ts";
import styles from "./Logs.module.css";

export type TimeRangePreset =
  | "all"
  | "1h"
  | "6h"
  | "24h"
  | "today"
  | "yesterday"
  | "7d"
  | "custom";

export const TIME_RANGE_LABELS: Record<TimeRangePreset, string> = {
  all: "All time",
  "1h": "Last 1h",
  "6h": "Last 6h",
  "24h": "Last 24h",
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  custom: "Custom",
};

export const ALL_LEVELS = ["info", "warn", "error", "debug"] as const;
export type LevelType = typeof ALL_LEVELS[number];

export const ALL_ACTIONS = ["start", "stop", "adjust_amps", "none"] as const;
export type ActionType = typeof ALL_ACTIONS[number];

export const ACTION_LABELS: Record<ActionType, string> = {
  start: "Start",
  stop: "Stop",
  adjust_amps: "Adjust",
  none: "None",
};

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

/** Convert ISO UTC string to `YYYY-MM-DDTHH:mm` in local time for <input type="datetime-local"> display. */
export function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${
    pad(d.getHours())
  }:${pad(d.getMinutes())}`;
}

/** Convert `YYYY-MM-DDTHH:mm` local-time input value to an ISO UTC string. */
export function localInputToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

type LogTab =
  | "charge-control"
  | "energy-reads"
  | "vehicle-updates"
  | "plugin-logs";

function getPresetRange(
  preset: TimeRangePreset,
): { from?: string; to?: string } {
  const now = new Date();
  switch (preset) {
    case "all":
      return {};
    case "1h":
      return { from: new Date(now.getTime() - 60 * 60 * 1000).toISOString() };
    case "6h":
      return {
        from: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
      };
    case "24h":
      return {
        from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      };
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString() };
    }
    case "yesterday": {
      const yStart = new Date(now);
      yStart.setDate(yStart.getDate() - 1);
      yStart.setHours(0, 0, 0, 0);
      const yEnd = new Date(now);
      yEnd.setDate(yEnd.getDate() - 1);
      yEnd.setHours(23, 59, 59, 999);
      return { from: yStart.toISOString(), to: yEnd.toISOString() };
    }
    case "7d":
      return {
        from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
    case "custom":
      return {};
  }
}

/** Read filter state from current URL search params */
function readFiltersFromUrl(): {
  tab?: LogTab;
  vehicle?: string;
  timeRange?: TimeRangePreset;
  customFrom?: string;
  customTo?: string;
  actions?: ActionType[];
} {
  const params = new URLSearchParams(globalThis.location?.search || "");
  const result: ReturnType<typeof readFiltersFromUrl> = {};

  const tab = params.get("tab");
  if (
    tab === "charge-control" || tab === "energy-reads" ||
    tab === "vehicle-updates" || tab === "plugin-logs"
  ) {
    result.tab = tab;
  }

  const vehicle = params.get("vehicle");
  if (vehicle) result.vehicle = vehicle;

  const tr = params.get("timeRange");
  if (tr && tr in TIME_RANGE_LABELS) result.timeRange = tr as TimeRangePreset;

  const cf = params.get("from");
  if (cf) result.customFrom = cf;

  const ct = params.get("to");
  if (ct) result.customTo = ct;

  const actionParam = params.get("action");
  if (actionParam) {
    const parsed = actionParam.split(",").filter((a): a is ActionType =>
      ALL_ACTIONS.includes(a as ActionType)
    );
    if (parsed.length > 0) result.actions = parsed;
  }

  return result;
}

/** Write current filters to URL search params using replaceState */
function writeFiltersToUrl(filters: {
  tab: LogTab;
  vehicle: string;
  timeRange: TimeRangePreset;
  customFrom: string;
  customTo: string;
  actions: ActionType[];
}) {
  const params = new URLSearchParams();

  if (filters.tab !== "charge-control") params.set("tab", filters.tab);
  if (filters.vehicle !== "all") params.set("vehicle", filters.vehicle);
  if (filters.timeRange !== "all") params.set("timeRange", filters.timeRange);
  if (filters.timeRange === "custom") {
    if (filters.customFrom) params.set("from", filters.customFrom);
    if (filters.customTo) params.set("to", filters.customTo);
  }
  // Only store action filter if not all actions selected
  if (
    filters.actions.length > 0 && filters.actions.length < ALL_ACTIONS.length
  ) {
    params.set("action", filters.actions.join(","));
  }

  const search = params.toString();
  const newUrl = `${globalThis.location.pathname}${search ? `?${search}` : ""}`;
  globalThis.history.replaceState(null, "", newUrl);
}

function useChargeControlTab(
  initialFilters: ReturnType<typeof readFiltersFromUrl>,
) {
  const [vehicleFilter, setVehicleFilter] = useState<string>(
    initialFilters.vehicle || "all",
  );
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(
    initialFilters.timeRange || "all",
  );
  const [customFrom, setCustomFrom] = useState(initialFilters.customFrom || "");
  const [customTo, setCustomTo] = useState(initialFilters.customTo || "");
  const [selectedActions, setSelectedActions] = useState<ActionType[]>(
    initialFilters.actions || [...ALL_ACTIONS],
  );
  const [logsPageSize, setLogsPageSize] = useStoredState(
    "logs.pageSize",
    50,
  );

  const timeFilter = useMemo(() => {
    if (timeRange === "custom") {
      return { from: customFrom || undefined, to: customTo || undefined };
    }
    return getPresetRange(timeRange);
  }, [timeRange, customFrom, customTo]);

  const actionFilter = useMemo(() => {
    if (selectedActions.length === ALL_ACTIONS.length) return undefined;
    if (selectedActions.length === 0) return undefined;
    return [...selectedActions];
  }, [selectedActions]);

  const data = useControllerLogs(
    vehicleFilter === "all" ? undefined : vehicleFilter,
    { ...timeFilter, action: actionFilter },
    logsPageSize,
  );

  const activeFilterCount = useMemo(() => {
    return (vehicleFilter !== "all" ? 1 : 0) +
      (timeRange !== "all" ? 1 : 0) +
      (selectedActions.length < ALL_ACTIONS.length ? 1 : 0);
  }, [vehicleFilter, timeRange, selectedActions]);

  const changesOnly = selectedActions.length === ALL_ACTIONS.length - 1 &&
    !selectedActions.includes("none");

  function toggleAction(action: ActionType) {
    setSelectedActions((prev) =>
      prev.includes(action)
        ? prev.filter((a) => a !== action)
        : [...prev, action]
    );
  }
  function toggleChangesOnly() {
    if (changesOnly) setSelectedActions([...ALL_ACTIONS]);
    else setSelectedActions(ALL_ACTIONS.filter((a) => a !== "none"));
  }
  function clearAllFilters() {
    setVehicleFilter("all");
    setTimeRange("all");
    setCustomFrom("");
    setCustomTo("");
    setSelectedActions([...ALL_ACTIONS]);
  }

  return {
    vehicleFilter,
    setVehicleFilter,
    timeRange,
    setTimeRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    selectedActions,
    logsPageSize,
    setLogsPageSize,
    data,
    activeFilterCount,
    changesOnly,
    toggleAction,
    toggleChangesOnly,
    clearAllFilters,
  };
}

function useTimeFilterState(initial: TimeRangePreset = "all") {
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(initial);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const timeFilter = useMemo(() => {
    if (timeRange === "custom") {
      return { from: customFrom || undefined, to: customTo || undefined };
    }
    return getPresetRange(timeRange);
  }, [timeRange, customFrom, customTo]);
  return {
    timeRange,
    setTimeRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    timeFilter,
  };
}

function useEnergyReadsTab() {
  const tf = useTimeFilterState();
  const [pageSize, setPageSize] = useStoredState("logs.pageSize", 50);
  const data = useEnergyReadings(tf.timeFilter, pageSize);
  const activeFilterCount = tf.timeRange !== "all" ? 1 : 0;
  const clear = () => {
    tf.setTimeRange("all");
    tf.setCustomFrom("");
    tf.setCustomTo("");
  };
  return { ...tf, pageSize, setPageSize, data, activeFilterCount, clear };
}

function useCarUpdatesTab() {
  const tf = useTimeFilterState();
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [pageSize, setPageSize] = useStoredState("logs.pageSize", 50);
  const data = useVehicleUpdates(
    vehicleFilter === "all" ? undefined : vehicleFilter,
    tf.timeFilter,
    pageSize,
  );
  const activeFilterCount = (vehicleFilter !== "all" ? 1 : 0) +
    (tf.timeRange !== "all" ? 1 : 0);
  const clear = () => {
    setVehicleFilter("all");
    tf.setTimeRange("all");
    tf.setCustomFrom("");
    tf.setCustomTo("");
  };
  return {
    ...tf,
    vehicleFilter,
    setVehicleFilter,
    pageSize,
    setPageSize,
    data,
    activeFilterCount,
    clear,
  };
}

function usePluginLogsTab() {
  const tf = useTimeFilterState();
  const [selectedLevels, setSelectedLevels] = useState<LevelType[]>([
    ...ALL_LEVELS,
  ]);
  const [pluginFilter, setPluginFilter] = useState("all");
  const [pageSize, setPageSize] = useStoredState("logs.pageSize", 50);
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(searchInput), 250);
    return () => clearTimeout(id);
  }, [searchInput]);
  const levelFilter = useMemo(() => {
    if (selectedLevels.length === ALL_LEVELS.length) return undefined;
    if (selectedLevels.length === 0) return undefined;
    return [...selectedLevels];
  }, [selectedLevels]);
  const data = usePluginLogs(
    {
      ...tf.timeFilter,
      level: levelFilter,
      pluginId: pluginFilter === "all" ? undefined : pluginFilter,
      search: searchDebounced.trim() || undefined,
    },
    pageSize,
  );
  const pluginIds = useMemo(() => {
    return [
      ...new Set(data.logs.map((log) => log.pluginId).filter(Boolean)),
    ].sort();
  }, [data.logs]);
  const activeFilterCount = (tf.timeRange !== "all" ? 1 : 0) +
    (selectedLevels.length < ALL_LEVELS.length ? 1 : 0) +
    (pluginFilter !== "all" ? 1 : 0) +
    (searchDebounced.trim() ? 1 : 0);
  const clear = () => {
    tf.setTimeRange("all");
    tf.setCustomFrom("");
    tf.setCustomTo("");
    setSelectedLevels([...ALL_LEVELS]);
    setPluginFilter("all");
    setSearchInput("");
  };
  return {
    ...tf,
    selectedLevels,
    setSelectedLevels,
    pluginFilter,
    setPluginFilter,
    pageSize,
    setPageSize,
    searchInput,
    setSearchInput,
    data,
    pluginIds,
    activeFilterCount,
    clear,
  };
}

export function Logs() {
  const initialFilters = useMemo(() => readFiltersFromUrl(), []);
  const [activeTab, setActiveTab] = useState<LogTab>(
    initialFilters.tab || "charge-control",
  );
  const { data: vehiclesData } = trpc.vehicle.list.useQuery();
  const vehicles = useMemo(
    () => (vehiclesData?.vehicles ?? []) as VehicleWithState[],
    [vehiclesData],
  );

  const cc = useChargeControlTab(initialFilters);
  const er = useEnergyReadsTab();
  const cu = useCarUpdatesTab();
  const pl = usePluginLogsTab();

  useEffect(() => {
    writeFiltersToUrl({
      tab: activeTab,
      vehicle: cc.vehicleFilter,
      timeRange: cc.timeRange,
      customFrom: cc.customFrom,
      customTo: cc.customTo,
      actions: cc.selectedActions,
    });
  }, [
    activeTab,
    cc.vehicleFilter,
    cc.timeRange,
    cc.customFrom,
    cc.customTo,
    cc.selectedActions,
  ]);

  return (
    <div className={styles.page}>
      <Text size="5" weight="bold">Logs</Text>
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as LogTab)}
      >
        <Tabs.List>
          <Tabs.Trigger value="charge-control">Charge Control</Tabs.Trigger>
          <Tabs.Trigger value="energy-reads">Energy Reads</Tabs.Trigger>
          <Tabs.Trigger value="vehicle-updates">Vehicle Updates</Tabs.Trigger>
          <Tabs.Trigger value="plugin-logs">Plugin Logs</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="charge-control">
          <ChargeControlTab cc={cc} vehicles={vehicles} />
        </Tabs.Content>
        <Tabs.Content value="energy-reads">
          <EnergyReadsTabContent er={er} />
        </Tabs.Content>
        <Tabs.Content value="vehicle-updates">
          <CarUpdatesTabContent cu={cu} vehicles={vehicles} />
        </Tabs.Content>
        <Tabs.Content value="plugin-logs">
          <PluginLogsTabContent pl={pl} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function ChargeControlTab(
  { cc, vehicles }: {
    cc: ReturnType<typeof useChargeControlTab>;
    vehicles: VehicleWithState[];
  },
) {
  return (
    <div className={styles.tabContent}>
      <LogFilterBar
        vehicleFilter={cc.vehicleFilter}
        onVehicleFilterChange={cc.setVehicleFilter}
        vehicles={vehicles}
        timeRange={cc.timeRange}
        onTimeRangeChange={cc.setTimeRange}
        customFrom={cc.customFrom}
        onCustomFromChange={cc.setCustomFrom}
        customTo={cc.customTo}
        onCustomToChange={cc.setCustomTo}
        selectedActions={cc.selectedActions}
        onToggleAction={cc.toggleAction}
        changesOnly={cc.changesOnly}
        onToggleChangesOnly={cc.toggleChangesOnly}
        activeFilterCount={cc.activeFilterCount}
        onClearAllFilters={cc.clearAllFilters}
        autoRefresh={cc.data.autoRefresh}
        onAutoRefreshChange={cc.data.setAutoRefresh}
        onRefresh={cc.data.refresh}
        isFetching={cc.data.isFetching}
      />
      <LogTable
        logs={cc.data.logs}
        loading={cc.data.loading}
        total={cc.data.total}
        page={cc.data.page}
        onPageChange={cc.data.setPage}
        pageSize={cc.logsPageSize}
        onPageSizeChange={cc.setLogsPageSize}
      />
    </div>
  );
}

function EnergyReadsTabContent(
  { er }: { er: ReturnType<typeof useEnergyReadsTab> },
) {
  return (
    <div className={styles.tabContent}>
      <SimpleFilterBar
        timeRange={er.timeRange}
        onTimeRangeChange={er.setTimeRange}
        customFrom={er.customFrom}
        onCustomFromChange={er.setCustomFrom}
        customTo={er.customTo}
        onCustomToChange={er.setCustomTo}
        activeFilterCount={er.activeFilterCount}
        onClearAllFilters={er.clear}
        autoRefresh={er.data.autoRefresh}
        onAutoRefreshChange={er.data.setAutoRefresh}
        onRefresh={er.data.refresh}
        isFetching={er.data.isFetching}
      />
      <EnergyReadsTable
        readings={er.data.readings}
        loading={er.data.loading}
        total={er.data.total}
        page={er.data.page}
        onPageChange={er.data.setPage}
        pageSize={er.pageSize}
        onPageSizeChange={er.setPageSize}
      />
    </div>
  );
}

function CarUpdatesTabContent(
  { cu, vehicles }: {
    cu: ReturnType<typeof useCarUpdatesTab>;
    vehicles: VehicleWithState[];
  },
) {
  return (
    <div className={styles.tabContent}>
      <SimpleFilterBar
        vehicles={vehicles}
        vehicleFilter={cu.vehicleFilter}
        onVehicleFilterChange={cu.setVehicleFilter}
        timeRange={cu.timeRange}
        onTimeRangeChange={cu.setTimeRange}
        customFrom={cu.customFrom}
        onCustomFromChange={cu.setCustomFrom}
        customTo={cu.customTo}
        onCustomToChange={cu.setCustomTo}
        activeFilterCount={cu.activeFilterCount}
        onClearAllFilters={cu.clear}
        autoRefresh={cu.data.autoRefresh}
        onAutoRefreshChange={cu.data.setAutoRefresh}
        onRefresh={cu.data.refresh}
        isFetching={cu.data.isFetching}
      />
      <VehicleUpdatesTable
        readings={cu.data.readings}
        loading={cu.data.loading}
        total={cu.data.total}
        page={cu.data.page}
        onPageChange={cu.data.setPage}
        pageSize={cu.pageSize}
        onPageSizeChange={cu.setPageSize}
        vehicles={vehicles}
      />
    </div>
  );
}

function PluginLogsTabContent(
  { pl }: { pl: ReturnType<typeof usePluginLogsTab> },
) {
  return (
    <div className={styles.tabContent}>
      <SimpleFilterBar
        timeRange={pl.timeRange}
        onTimeRangeChange={pl.setTimeRange}
        customFrom={pl.customFrom}
        onCustomFromChange={pl.setCustomFrom}
        customTo={pl.customTo}
        onCustomToChange={pl.setCustomTo}
        activeFilterCount={pl.activeFilterCount}
        onClearAllFilters={pl.clear}
        autoRefresh={pl.data.autoRefresh}
        onAutoRefreshChange={pl.data.setAutoRefresh}
        onRefresh={pl.data.refresh}
        isFetching={pl.data.isFetching}
        levelFilter={pl.selectedLevels}
        onLevelFilterChange={(levels: string[]) =>
          pl.setSelectedLevels(levels as LevelType[])}
        allLevels={ALL_LEVELS}
        pluginIds={pl.pluginIds}
        pluginFilter={pl.pluginFilter}
        onPluginFilterChange={pl.setPluginFilter}
        search={pl.searchInput}
        onSearchChange={pl.setSearchInput}
        searchPlaceholder="Search logs (use -term to exclude)"
      />
      <PluginLogsTable
        logs={pl.data.logs}
        loading={pl.data.loading}
        total={pl.data.total}
        page={pl.data.page}
        onPageChange={pl.data.setPage}
        pageSize={pl.pageSize}
        onPageSizeChange={pl.setPageSize}
      />
    </div>
  );
}
