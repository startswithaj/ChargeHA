import { useEffect, useState } from "react";
import { FilterX, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Select,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { VehicleWithState } from "@chargeha/shared";
import type { ActionType, TimeRangePreset } from "./Logs.tsx";
import {
  ACTION_LABELS,
  ALL_ACTIONS,
  isoToLocalInput,
  localInputToIso,
  TIME_RANGE_LABELS,
} from "./Logs.tsx";
import styles from "./Logs.module.css";

interface LogFilterBarProps {
  vehicleFilter: string;
  onVehicleFilterChange: (v: string) => void;
  vehicles: VehicleWithState[];
  timeRange: TimeRangePreset;
  onTimeRangeChange: (v: TimeRangePreset) => void;
  customFrom: string;
  onCustomFromChange: (v: string) => void;
  customTo: string;
  onCustomToChange: (v: string) => void;
  selectedActions: ActionType[];
  onToggleAction: (action: ActionType) => void;
  changesOnly: boolean;
  onToggleChangesOnly: () => void;
  activeFilterCount: number;
  onClearAllFilters: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
  onRefresh: () => void;
  isFetching?: boolean;
}

function ActionCheckboxes(
  { selectedActions, onToggleAction, changesOnly, onToggleChangesOnly }: {
    selectedActions: ActionType[];
    onToggleAction: (action: ActionType) => void;
    changesOnly: boolean;
    onToggleChangesOnly: () => void;
  },
) {
  return (
    <div className={styles.actionFilters} data-testid="action-filters">
      {ALL_ACTIONS.map((action) => (
        <label key={action} className={styles.actionCheckbox}>
          <Checkbox
            size="1"
            checked={selectedActions.includes(action)}
            onCheckedChange={() =>
              onToggleAction(action)}
            data-testid={`action-${action}`}
          />
          <Text size="1">{ACTION_LABELS[action]}</Text>
        </label>
      ))}
      <label className={styles.actionCheckbox}>
        <Checkbox
          size="1"
          checked={changesOnly}
          onCheckedChange={() => onToggleChangesOnly()}
          data-testid="changes-only"
        />
        <Text size="1">Changes only</Text>
      </label>
    </div>
  );
}

function CustomRange(
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
          data-testid="custom-from"
        />
      </label>
      <label>
        <Text size="1" color="gray">To</Text>
        <TextField.Root
          type="datetime-local"
          value={isoToLocalInput(customTo)}
          onChange={(e) => onCustomToChange(localInputToIso(e.target.value))}
          data-testid="custom-to"
        />
      </label>
    </div>
  );
}

export function LogFilterBar({
  vehicleFilter,
  onVehicleFilterChange,
  vehicles,
  timeRange,
  onTimeRangeChange,
  customFrom,
  onCustomFromChange,
  customTo,
  onCustomToChange,
  selectedActions,
  onToggleAction,
  changesOnly,
  onToggleChangesOnly,
  activeFilterCount,
  onClearAllFilters,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  isFetching,
}: LogFilterBarProps) {
  const spinning = useMinDuration(isFetching ?? false, 500);

  return (
    <>
      <div className={styles.toolbar}>
        <Select.Root
          value={vehicleFilter}
          onValueChange={onVehicleFilterChange}
        >
          <Select.Trigger placeholder="All vehicles" />
          <Select.Content>
            <Select.Item value="all">All vehicles</Select.Item>
            {vehicles.map((v) => (
              <Select.Item key={v.id} value={v.id}>
                {v.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>

        <Select.Root
          value={timeRange}
          onValueChange={(v) => onTimeRangeChange(v as TimeRangePreset)}
        >
          <Select.Trigger
            placeholder="All time"
            data-testid="time-range-trigger"
          />
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

        <ActionCheckboxes
          selectedActions={selectedActions}
          onToggleAction={onToggleAction}
          changesOnly={changesOnly}
          onToggleChangesOnly={onToggleChangesOnly}
        />

        {activeFilterCount > 0 && (
          <>
            <Badge size="1" variant="solid" data-testid="filter-count-badge">
              {activeFilterCount}
            </Badge>
            <Button
              size="1"
              variant="ghost"
              onClick={onClearAllFilters}
              data-testid="clear-filters"
            >
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
          <Button
            size="1"
            variant="ghost"
            onClick={onRefresh}
            data-testid="refresh-button"
          >
            <RefreshCw
              size={14}
              className={spinning ? styles.spin : undefined}
            />
          </Button>
        </div>
      </div>

      {timeRange === "custom" && (
        <CustomRange
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
