import {
  ArrowUpDown,
  BatteryCharging,
  Calendar,
  CloudSun,
  Plug,
  ShieldBan,
  Sun,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Text, Tooltip } from "@radix-ui/themes";
import type { VehicleChargeState } from "@chargeha/shared";
import { kwValue } from "../../utils/Format.ts";
import { Spinner } from "../ui/Spinner.tsx";
import styles from "./VehicleCard.module.css";

/** Which controller reasons warrant a visible status row. */
const VISIBLE_REASONS = new Set([
  "schedule",
  "blockout",
  "grace_period",
  "cooldown",
  "battery_priority",
]);

const REASON_ICONS: Record<string, LucideIcon> = {
  schedule: Calendar,
  blockout: ShieldBan,
  grace_period: CloudSun,
  cooldown: CloudSun,
  battery_priority: BatteryCharging,
};

const REASON_COLORS: Record<string, "blue" | "orange"> = {
  schedule: "blue",
  blockout: "orange",
  grace_period: "orange",
  cooldown: "orange",
  battery_priority: "orange",
};

/** User-friendly label formatters per reason. */
const REASON_LABELS: Record<string, (detail: string) => string> = {
  schedule: (detail) => {
    const match = detail.match(/schedule (\d{2}:\d{2}-\d{2}:\d{2})/);
    return match
      ? `Charging on schedule (${match[1]})`
      : "Charging on schedule";
  },
  blockout: () => "Blockout schedule active",
  grace_period: (detail) => {
    const match = detail.match(/(\d+s\/\d+s)/);
    return match
      ? `Low solar — grace period (${match[1]})`
      : "Low solar — grace period active";
  },
  cooldown: (detail) => {
    const match = detail.match(/(\d+)s remaining/);
    return match ? `Cooldown — ${match[1]}s remaining` : "Cooldown active";
  },
  battery_priority: (detail) => {
    const match = detail.match(/(\d+)%.*<.*(\d+)%/);
    return match
      ? `Home battery priority (${match[1]}% < ${match[2]}%)`
      : "Waiting for home battery";
  },
};

interface VehicleCardDetailsProps {
  state: VehicleChargeState;
  disabled: boolean;
  commandPending: string | false;
  onStartCharging: () => void;
  onStopCharging: () => void;
  onSetAmps: (amps: number) => void;
  solarPowerW: number;
  gridPowerW: number;
  chargeLimitPercent: number;
  allocationStatus: string | null;
  controllerReason: string | null;
  controllerDetail: string | null;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function ChargeButton(
  { isCharging, disabled, commandPending, onStart, onStop }: {
    isCharging: boolean;
    disabled: boolean;
    commandPending: string | false;
    onStart: () => void;
    onStop: () => void;
  },
) {
  if (isCharging) {
    return (
      <Button
        variant="soft"
        color="red"
        size="2"
        disabled={disabled}
        onClick={onStop}
      >
        {commandPending === "stop" ? <Spinner /> : null}
        {commandPending === "stop" ? "Stopping..." : "Stop Charging"}
      </Button>
    );
  }
  return (
    <Button
      variant="soft"
      color="green"
      size="2"
      disabled={disabled}
      onClick={onStart}
    >
      {commandPending === "start" ? <Spinner /> : null}
      {commandPending === "start" ? "Starting..." : "Start Charging"}
    </Button>
  );
}

function ControllerReasonRow(
  { reason, detail }: { reason: string; detail: string },
) {
  const Icon = REASON_ICONS[reason];
  const label = REASON_LABELS[reason]?.(detail) ?? detail;
  const color = REASON_COLORS[reason] ?? "gray";
  return (
    <div className={styles.detailRow}>
      {Icon && <Icon size={14} />}
      <Text size="1" color={color}>{label}</Text>
    </div>
  );
}

function AmpsControl(
  { state, disabled, commandPending, onSetAmps }: {
    state: VehicleChargeState;
    disabled: boolean;
    commandPending: string | false;
    onSetAmps: (amps: number) => void;
  },
) {
  return (
    <Tooltip content="Start charging to adjust amps" hidden={state.isCharging}>
      <div className={styles.ampsControl}>
        <Button
          variant="ghost"
          size="1"
          disabled={disabled || !state.isCharging ||
            state.chargeAmps <= state.chargeAmpsMin}
          onClick={() =>
            onSetAmps(state.chargeAmps - 1)}
        >
          {commandPending === "amps" ? <Spinner /> : "−"}
        </Button>
        <Text size="2" weight="bold">{state.chargeAmps}A</Text>
        <Button
          variant="ghost"
          size="1"
          disabled={disabled || !state.isCharging ||
            state.chargeAmps >= state.chargeAmpsMax}
          onClick={() =>
            onSetAmps(state.chargeAmps + 1)}
        >
          {commandPending === "amps" ? <Spinner /> : "+"}
        </Button>
      </div>
    </Tooltip>
  );
}

export function VehicleCardDetails({
  state,
  disabled,
  commandPending,
  onStartCharging,
  onStopCharging,
  onSetAmps,
  solarPowerW,
  gridPowerW,
  chargeLimitPercent,
  allocationStatus,
  controllerReason,
  controllerDetail,
}: VehicleCardDetailsProps) {
  return (
    <>
      {/* Charge details */}
      <div className={styles.details}>
        <div className={styles.detailRow}>
          <Zap size={14} />
          <Text size="1" color="gray">
            {state.isCharging
              ? `${state.chargeAmps}A / ${state.chargeAmpsMax}A max`
              : "Not Charging"}
          </Text>
        </div>
        {allocationStatus && (
          <div className={styles.detailRow}>
            <ArrowUpDown size={14} />
            <Text size="1" color="yellow">{allocationStatus}</Text>
          </div>
        )}
        {controllerReason && controllerDetail &&
          VISIBLE_REASONS.has(controllerReason) && (
          <ControllerReasonRow
            reason={controllerReason}
            detail={controllerDetail}
          />
        )}
        {state.isCharging && (
          <>
            {(solarPowerW > 0 || gridPowerW > 0) && (
              <div className={styles.detailRow}>
                <Sun size={14} />
                <Text size="1" color="gray">
                  {kwValue(solarPowerW)} solar, {kwValue(gridPowerW)} grid
                </Text>
              </div>
            )}
            <div className={styles.detailRow}>
              <BatteryCharging size={14} />
              <Text size="1" color="gray">
                {state.energyAddedKwh.toFixed(1)} kWh added
              </Text>
            </div>
            {state.minutesToFull > 0 && (
              <div className={styles.detailRow}>
                <Plug size={14} />
                <Text size="1" color="gray">
                  {formatMinutes(state.minutesToFull)} to {chargeLimitPercent}%
                </Text>
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.buttonRow}>
          <ChargeButton
            isCharging={state.isCharging}
            disabled={disabled}
            commandPending={commandPending}
            onStart={onStartCharging}
            onStop={onStopCharging}
          />
        </div>
        <AmpsControl
          state={state}
          disabled={disabled}
          commandPending={commandPending}
          onSetAmps={onSetAmps}
        />
      </div>
    </>
  );
}
