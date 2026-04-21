import { useEffect, useState } from "react";
import { FilterX, Info, RefreshCw, Search } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Select,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import type { VehicleWithState } from "@chargeha/shared";
import type { TimeRangePreset } from "./Logs.tsx";
import {
  isoToLocalInput,
  localInputToIso,
  TIME_RANGE_LABELS,
} from "./Logs.tsx";
import styles from "./Logs.module.css";

interface SimpleFilterBarProps {
  vehicles?: VehicleWithState[];
  vehicleFilter?: string;
  onVehicleFilterChange?: (v: string) => void;
  timeRange: TimeRangePreset;
  onTimeRangeChange: (v: TimeRangePreset) => void;
  customFrom: string;
  onCustomFromChange: (v: string) => void;
  customTo: string;
  onCustomToChange: (v: string) => void;
  activeFilterCount: number;
  onClearAllFilters: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
  onRefresh: () => void;
  isFetching?: boolean;
  levelFilter?: string[];
  onLevelFilterChange?: (levels: string[]) => void;
  allLevels?: readonly string[];
  pluginIds?: string[];
  pluginFilter?: string;
  onPluginFilterChange?: (v: string) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
}

function VehicleSelect(
  { vehicles, vehicleFilter, onVehicleFilterChange }: {
    vehicles: VehicleWithState[];
    vehicleFilter: string;
    onVehicleFilterChange: (v: string) => void;
  },
) {
  return (
    <Select.Root value={vehicleFilter} onValueChange={onVehicleFilterChange}>
      <Select.Trigger placeholder="All vehicles" />
      <Select.Content>
        <Select.Item value="all">All vehicles</Select.Item>
        {vehicles.map((v) => (
          <Select.Item key={v.id} value={v.id}>{v.name}</Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function PluginSelect(
  { pluginIds, pluginFilter, onPluginFilterChange }: {
    pluginIds: string[];
    pluginFilter: string;
    onPluginFilterChange: (v: string) => void;
  },
) {
  return (
    <Select.Root value={pluginFilter} onValueChange={onPluginFilterChange}>
      <Select.Trigger placeholder="All plugins" />
      <Select.Content>
        <Select.Item value="all">All plugins</Select.Item>
        {pluginIds.map((id) => (
          <Select.Item key={id} value={id}>{id}</Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function LevelCheckboxes(
  { allLevels, levelFilter, onLevelFilterChange }: {
    allLevels: readonly string[];
    levelFilter: string[];
    onLevelFilterChange: (levels: string[]) => void;
  },
) {
  return (
    <div className={styles.actionFilters}>
      {allLevels.map((level) => (
        <label key={level} className={styles.actionCheckbox}>
          <Checkbox
            size="1"
            data-testid={`level-checkbox-${level}`}
            checked={levelFilter.includes(level)}
            onCheckedChange={(checked) => {
              if (checked) {
                onLevelFilterChange([...levelFilter, level]);
              } else {
                onLevelFilterChange(levelFilter.filter((l) =>
                  l !== level
                ));
              }
            }}
          />
          <Text size="1">{level}</Text>
        </label>
      ))}
    </div>
  );
}

function SearchField(
  { value, onChange, placeholder }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
  },
) {
  return (
    <TextField.Root
      size="1"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ flex: "1 1 180px", minWidth: 160, maxWidth: 360 }}
    >
      <TextField.Slot>
        <Search size={14} />
      </TextField.Slot>
      <TextField.Slot>
        <Tooltip
          content={
            <span>
              Prefix a term with <b>-</b>{" "}
              to exclude it. Tokens are space-separated.
              <br />
              e.g. <b>charge -online-check</b>{" "}
              matches charge logs but hides online-check rows.
            </span>
          }
        >
          <Info size={14} style={{ cursor: "help", opacity: 0.6 }} />
        </Tooltip>
      </TextField.Slot>
    </TextField.Root>
  );
}

function CustomRangePicker(
  { customFrom, customTo, onCustomFromChange, onCustomToChange }: {
    customFrom: string;
    customTo: string;
    onCustomFromChange: (v: string) => void;
    onCustomToChange: (v: string) => void;
  },
) {
  return (
    <div className={styles.customRange}>
      <label>
        <Text size="1" color="gray">From</Text>
        <TextField.Root
          type="datetime-local"
          value={isoToLocalInput(customFrom)}
          onChange={(e) => onCustomFromChange(localInputToIso(e.target.value))}
        />
      </label>
      <label>
        <Text size="1" color="gray">To</Text>
        <TextField.Root
          type="datetime-local"
          value={isoToLocalInput(customTo)}
          onChange={(e) => onCustomToChange(localInputToIso(e.target.value))}
        />
      </label>
    </div>
  );
}

export function SimpleFilterBar({
  vehicles,
  vehicleFilter,
  onVehicleFilterChange,
  timeRange,
  onTimeRangeChange,
  customFrom,
  onCustomFromChange,
  customTo,
  onCustomToChange,
  activeFilterCount,
  onClearAllFilters,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  isFetching,
  levelFilter,
  onLevelFilterChange,
  allLevels,
  pluginIds,
  pluginFilter,
  onPluginFilterChange,
  search,
  onSearchChange,
  searchPlaceholder,
}: SimpleFilterBarProps) {
  // Hold spinning true long enough for the 600ms animation to complete,
  // so a fast cache-hit fetch still gets a full rotation instead of snapping.
  const spinning = useMinDuration(isFetching ?? false, 600);

  return (
    <>
      <div className={styles.toolbar}>
        {vehicles && onVehicleFilterChange && vehicleFilter !== undefined && (
          <VehicleSelect
            vehicles={vehicles}
            vehicleFilter={vehicleFilter}
            onVehicleFilterChange={onVehicleFilterChange}
          />
        )}

        {pluginIds && onPluginFilterChange && pluginFilter !== undefined && (
          <PluginSelect
            pluginIds={pluginIds}
            pluginFilter={pluginFilter}
            onPluginFilterChange={onPluginFilterChange}
          />
        )}

        <Select.Root
          value={timeRange}
          onValueChange={(v) => onTimeRangeChange(v as TimeRangePreset)}
        >
          <Select.Trigger placeholder="All time" />
          <Select.Content>
            {(Object.keys(TIME_RANGE_LABELS) as TimeRangePreset[]).map((
              key,
            ) => (
              <Select.Item key={key} value={key}>
                {TIME_RANGE_LABELS[key]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>

        {allLevels && levelFilter && onLevelFilterChange && (
          <LevelCheckboxes
            allLevels={allLevels}
            levelFilter={levelFilter}
            onLevelFilterChange={onLevelFilterChange}
          />
        )}

        {onSearchChange && (
          <SearchField
            value={search ?? ""}
            onChange={onSearchChange}
            placeholder={searchPlaceholder ?? "Search…"}
          />
        )}

        {activeFilterCount > 0 && (
          <>
            <Badge size="1" variant="solid">
              {activeFilterCount}
            </Badge>
            <Button size="1" variant="ghost" onClick={onClearAllFilters}>
              <FilterX size={14} />
              Clear filters
            </Button>
          </>
        )}

        <div className={styles.toolbarRight}>
          <Text size="1" color="gray">
            Auto-refresh
          </Text>
          <Switch
            size="1"
            checked={autoRefresh}
            onCheckedChange={onAutoRefreshChange}
          />
          <Button size="1" variant="ghost" onClick={onRefresh}>
            <RefreshCw
              size={14}
              className={spinning ? styles.spin : undefined}
            />
          </Button>
        </div>
      </div>

      {timeRange === "custom" && (
        <CustomRangePicker
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={onCustomFromChange}
          onCustomToChange={onCustomToChange}
        />
      )}
    </>
  );
}

/** Holds `active` true for at least `minMs` after it goes true, so brief
 *  truthy windows (fast react-query fetches) remain visible. */
function useMinDuration(active: boolean, minMs: number): boolean {
  const [visible, setVisible] = useState(active);
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), minMs);
    return () => clearTimeout(t);
  }, [active, minMs]);
  return visible;
}
