import { Badge, Button, Card, Text } from "@radix-ui/themes";
import {
  Activity,
  BatteryCharging,
  Plug,
  PlugZap,
  Settings,
  Sun,
  TriangleAlert,
  Unplug,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChargerState, ChargingPointMode } from "@chargeha/shared";
import { kwhValue, kwValue } from "../../../utils/Format.ts";
import { useChargerCommands } from "../../../hooks/useChargers.ts";
import { Spinner } from "../../ui/Spinner.tsx";
import layout from "../../ui/CardLayout.module.css";

const STATUS_LABELS: Record<ChargerState["status"], string> = {
  available: "Available",
  preparing: "Preparing",
  charging: "Charging",
  suspended: "Suspended",
  faulted: "Faulted",
  finishing: "Finishing",
  no_draw: "No draw",
  unconfigured: "Setup needed",
};

const STATUS_BADGE_COLORS: Record<
  ChargerState["status"],
  "green" | "red" | "gray"
> = {
  available: "gray",
  preparing: "gray",
  charging: "green",
  suspended: "gray",
  faulted: "red",
  finishing: "gray",
  no_draw: "gray",
  unconfigured: "red",
};

const MODE_BUTTONS: {
  value: ChargingPointMode;
  label: string;
  color: "red" | "blue" | "green";
}[] = [
  { value: "stop", label: "STOP", color: "red" },
  { value: "auto", label: "AUTO", color: "blue" },
  { value: "charge_now", label: "CHARGE NOW", color: "green" },
];

const MODE_LABELS: Record<ChargingPointMode, string> = {
  auto: "Auto",
  charge_now: "Charge Now",
  stop: "Stopped",
};

function DetailRow(
  { icon: Icon, color = "gray", children }: {
    icon: LucideIcon;
    color?: "gray" | "yellow" | "red";
    children: React.ReactNode;
  },
) {
  return (
    <div className={layout.detailRow}>
      <Icon size={14} />
      <Text size="1" color={color}>{children}</Text>
    </div>
  );
}

export function NoDrawNotice(
  { statusDetail }: { statusDetail: string | null },
) {
  return (
    <DetailRow icon={Unplug}>
      No draw — vehicle may be absent, finished, or paused
      {statusDetail ? ` (${statusDetail})` : ""}
    </DetailRow>
  );
}

/** Nothing will charge until someone intervenes: red card, warning icon. */
const ALARM_STATUSES = new Set<ChargerState["status"]>([
  "faulted",
  "unconfigured",
]);

const isAlarm = (state: ChargerState | null): boolean =>
  state !== null && ALARM_STATUSES.has(state.status);

/** Adapters phrase their detail as a sentence fragment ("off", "overheated"),
 *  but it leads its own line here. */
const sentenceCase = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** The device's own account of itself — raw OCPP status, or the wattage a
 *  smart plug actually measures. Worth a line even when it echoes the draw:
 *  this is the hardware talking, not the controller. */
function DeviceStatusRow({ state }: { state: ChargerState | null }) {
  if (!state) return null;
  // The status line already carries the unconfigured reason in full.
  if (state.status === "unconfigured") return null;
  if (state.status === "no_draw") {
    return <NoDrawNotice statusDetail={state.statusDetail} />;
  }
  if (!state.statusDetail) return null;
  return (
    <DetailRow icon={PlugZap}>{sentenceCase(state.statusDetail)}</DetailRow>
  );
}

function StatusIcon({ state }: { state: ChargerState | null }) {
  const iconStyle = (color: string) => ({ color, flexShrink: 0 });
  // No state = first poll still in flight, not a device reporting blank.
  if (!state) return <Spinner />;
  if (isAlarm(state)) {
    return <TriangleAlert size={14} style={iconStyle("var(--red-11)")} />;
  }
  if (state.isCharging) {
    return (
      <BatteryCharging size={14} style={iconStyle("var(--color-charging)")} />
    );
  }
  // Smart plugs report null (no cable sensing) — only a hard false is unplugged.
  if (state.isPluggedIn === false) {
    return <Unplug size={14} style={iconStyle("var(--color-disconnected)")} />;
  }
  return <Plug size={14} style={iconStyle("var(--color-vehicle)")} />;
}

function getStatusText(
  state: ChargerState | null,
  mode: ChargingPointMode,
): string {
  const label = MODE_LABELS[mode];
  if (!state) return `${label} - Connecting to the charger…`;
  // The badge already names the state; this line carries only the reason.
  if (state.status === "unconfigured") {
    return state.statusDetail
      ? sentenceCase(state.statusDetail)
      : STATUS_LABELS.unconfigured;
  }
  if (state.isCharging) {
    return `${label} - Charging at ${
      kwValue((state.chargePowerKw ?? 0) * 1000)
    }`;
  }
  return `${label} - ${STATUS_LABELS[state.status]}`;
}

export function ChargerCard(
  { id, name, mode, state, solarW, gridW, controllerDetail }: {
    id: string;
    name: string;
    mode: ChargingPointMode;
    state: ChargerState | null;
    solarW: number;
    gridW: number;
    controllerDetail: string | null;
  },
) {
  const { commandPending, changeMode } = useChargerCommands(id);
  const unconfigured = state?.status === "unconfigured";
  const alarm = isAlarm(state);

  return (
    <Card
      className={layout.card}
      style={{
        "--accent": alarm ? "var(--red-a7)" : "var(--color-charging)",
      } as React.CSSProperties}
    >
      <div className={layout.header}>
        <div className={layout.headerLeft}>
          <Zap size={20} style={{ color: "var(--color-charging)" }} />
          <Text size="3" weight="bold">{name}</Text>
        </div>
        <Badge
          variant="soft"
          color={state ? STATUS_BADGE_COLORS[state.status] : "gray"}
        >
          {state ? STATUS_LABELS[state.status] : "Connecting"}
        </Badge>
      </div>

      <div className={layout.modeToggle}>
        {MODE_BUTTONS.map((btn) => (
          <Button
            key={btn.value}
            variant={mode === btn.value ? "solid" : "outline"}
            color={mode === btn.value ? btn.color : "gray"}
            size="1"
            // No adapter, nothing to command.
            disabled={commandPending !== false || unconfigured}
            onClick={() => changeMode(btn.value)}
          >
            {commandPending === `mode:${btn.value}` ? <Spinner /> : null}
            {btn.label}
          </Button>
        ))}
      </div>

      <div className={layout.status}>
        <StatusIcon state={state} />
        <Text size="2">{getStatusText(state, mode)}</Text>
      </div>

      <div className={layout.details}>
        {unconfigured && (
          <DetailRow icon={Settings}>
            Open charger settings to finish setup
          </DetailRow>
        )}
        {/* Nothing has reported yet, so "not charging" would be a guess. */}
        {state && !unconfigured && (
          <DetailRow icon={Zap}>
            {state.isCharging
              ? `${state.chargeAmps ?? 0}A / ${state.chargeAmpsMax}A max`
              : "Not charging"}
          </DetailRow>
        )}
        {state?.isCharging && solarW + gridW > 0 && (
          <DetailRow icon={Sun}>
            {kwValue(solarW)} solar, {kwValue(gridW)} grid
          </DetailRow>
        )}
        {state && state.energyAddedKwh > 0 && (
          <DetailRow icon={BatteryCharging}>
            {kwhValue(state.energyAddedKwh * 1000)} added this session
          </DetailRow>
        )}
        {controllerDetail && (
          <DetailRow icon={Activity}>{controllerDetail}</DetailRow>
        )}
        <DeviceStatusRow state={state} />
      </div>
    </Card>
  );
}
