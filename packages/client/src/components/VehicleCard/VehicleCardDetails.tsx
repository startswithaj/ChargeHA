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
import { ampsRange, ampsValue, kwValue } from "../../utils/Format.ts";
import { Spinner } from "../ui/Spinner.tsx";
import layout from "../ui/CardLayout.module.css";
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

/** True when a controller reason is worth its own formatted row. Callers that
 *  also have a fallback for unformatted reasons need to know which they got. */
export const isVisibleReason = (reason: string | null): boolean =>
  reason !== null && VISIBLE_REASONS.has(reason);

/** Renders nothing for a reason with no user-facing phrasing, so callers can
 *  hand it whatever the controller reported without filtering first. */
export function ControllerReasonRow(
  { reason, detail }: { reason: string | null; detail: string | null },
) {
  if (reason === null || detail === null || !isVisibleReason(reason)) {
    return null;
  }
  const Icon = REASON_ICONS[reason];
  const label = REASON_LABELS[reason]?.(detail) ?? detail;
  const color = REASON_COLORS[reason] ?? "gray";
  return (
    <div className={layout.detailRow}>
      {Icon && <Icon size={14} />}
      <Text size="1" color={color}>{label}</Text>
    </div>
  );
}

/** How long until the car reaches its own charge limit. The only charging row
 *  a charger cannot produce: `minutesToFull` and the limit are the vehicle's
 *  own numbers, not anything the charger measures. */
function TimeToFullRow(
  { state, chargeLimitPercent }: {
    state: VehicleChargeState;
    chargeLimitPercent: number;
  },
) {
  // Gated on the estimate alone, not on the car's own isCharging flag. A car
  // driven by a smart charger never sees its own startCharging, so that flag
  // stays false while the charger is delivering energy; the adapter only
  // produces a non-zero estimate when it believes it is charging anyway, so
  // the extra condition ruled the row out without adding anything.
  if (state.minutesToFull <= 0) return null;
  return (
    <div className={layout.detailRow}>
      <Plug size={14} />
      <Text size="1" color="gray">
        {formatMinutes(state.minutesToFull)} to {chargeLimitPercent}%
      </Text>
    </div>
  );
}

/** The detail block for a car whose charging a smart charger owns.
 *
 * `readOnly` used to drop this block whole, which cost the user real
 * information rather than just the controls. Every other row — amps,
 * solar/grid, energy added, allocation status, controller reason — is measured
 * by the charger and already shown on the charger card sitting directly above
 * this one, so repeating them here would be the same fact twice, six inches
 * apart. Time to full is the one row that card cannot produce, so it is the
 * one row that stays. */
export function PairedChargeDetails(
  { state, chargeLimitPercent }: {
    state: VehicleChargeState;
    chargeLimitPercent: number;
  },
) {
  return (
    <div className={layout.details}>
      <TimeToFullRow state={state} chargeLimitPercent={chargeLimitPercent} />
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
        <Text size="2" weight="bold">{ampsValue(state.chargeAmps)}</Text>
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
      <div className={layout.details}>
        <div className={layout.detailRow}>
          <Zap size={14} />
          <Text size="1" color="gray">
            {state.isCharging
              ? ampsRange(state.chargeAmps, state.chargeAmpsMax)
              : "Not Charging"}
          </Text>
        </div>
        {allocationStatus && (
          <div className={layout.detailRow}>
            <ArrowUpDown size={14} />
            <Text size="1" color="yellow">{allocationStatus}</Text>
          </div>
        )}
        <ControllerReasonRow
          reason={controllerReason}
          detail={controllerDetail}
        />

        {state.isCharging && (
          <>
            {(solarPowerW > 0 || gridPowerW > 0) && (
              <div className={layout.detailRow}>
                <Sun size={14} />
                <Text size="1" color="gray">
                  {kwValue(solarPowerW)} solar, {kwValue(gridPowerW)} grid
                </Text>
              </div>
            )}
            <div className={layout.detailRow}>
              <BatteryCharging size={14} />
              <Text size="1" color="gray">
                {state.energyAddedKwh.toFixed(1)} kWh added
              </Text>
            </div>
          </>
        )}
        <TimeToFullRow state={state} chargeLimitPercent={chargeLimitPercent} />
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
