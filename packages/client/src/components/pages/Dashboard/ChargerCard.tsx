import { Badge, Button, Card, Link, Text } from "@radix-ui/themes";
import {
  Activity,
  ArrowUpDown,
  BatteryCharging,
  Car,
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

// Mirrors ChargingPointManager's VehicleResolution["kind"] — kept local
// since the type isn't shared, only the tRPC output that carries it.
type VehicleResolutionKind = "linked" | "inferred" | "ambiguous" | "none";

// Mirrors ChargingPointManager's ControlPath["owner"]. "vehicle_api" only ever
// describes a SMART charger gone passive — getControlPath returns "self" for a
// vehicle_api row, because that row IS the car's own API.
type ControlOwner = "self" | "vehicle_api";
import { ampsRange, kwhValue, kwValue } from "../../../utils/Format.ts";
import { useChargerCommands } from "../../../hooks/useChargers.ts";
import {
  ControllerReasonRow,
  isVisibleReason,
} from "../../VehicleCard/VehicleCardDetails.tsx";
import {
  CHARGERS_ANCHOR_ID,
  revealSettingsSection,
} from "../../../lib/settingsAnchors.ts";
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
  // Current is flowing, so the badge, the status line and the amps row all
  // say charging. A charger that has not sent a status yet reports that
  // absence here, which then contradicts three rows above it on the same
  // card. While it is charging, the measurement is the better witness.
  if (state.isCharging) return null;
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
  passive: boolean,
): string {
  // A passive charger is not in a mode it honours — it passes current for a
  // car that decides — so naming one would misdescribe what it is doing.
  const label = passive ? "" : `${MODE_LABELS[mode]} - `;
  if (!state) return `${label}Connecting to the charger…`;
  // The badge already names the state; this line carries only the reason.
  if (state.status === "unconfigured") {
    return state.statusDetail
      ? sentenceCase(state.statusDetail)
      : STATUS_LABELS.unconfigured;
  }
  if (state.isCharging) {
    return `${label}Charging at ${kwValue((state.chargePowerKw ?? 0) * 1000)}`;
  }
  return `${label}${STATUS_LABELS[state.status]}`;
}

/** What the charger resolved to, in the user's words.
 *
 * A smart charger's assignment is a preference, not a lock (see
 * ChargingPointManager.resolveSmartCharger): "linked" means someone assigned
 * this car and it is plugged in here, "inferred" means nobody assigned
 * anything and ChargeHA found the only car that is plugged in. The wording
 * has to carry that difference, because only one of them survives a second
 * car being plugged in.
 *
 * Neither says "charging": resolution is about which car is on the charger,
 * and a plugged-in car that is not drawing still resolves.
 *
 * "none" and "ambiguous" get no line: there is no car to name, and the status
 * line and badge above already say the charger is idle. */
function resolvedVehicleText(
  kind: VehicleResolutionKind,
  name: string | null,
): string | null {
  if (name === null) return null;
  if (kind === "linked") return `${name} assigned to this charger`;
  if (kind === "inferred") return `${name} detected automatically`;
  return null;
}

/** What this charger has to say about the car on it. A passive charger says
 *  who is driving instead of what it resolved: it is holding a standing
 *  permission open for a car that commands itself, so "detected
 *  automatically" would imply a control it is not exercising. */
function vehicleLine(
  controlOwner: ControlOwner,
  passiveForVehicleName: string | null,
  kind: VehicleResolutionKind,
  resolvedVehicleName: string | null,
): string | null {
  if (controlOwner === "self") {
    return resolvedVehicleText(kind, resolvedVehicleName);
  }
  return passiveForVehicleName === null
    ? "Controlled by the vehicle's own API"
    : `Controlled by ${passiveForVehicleName}`;
}

/** Only rendered for a charger that is deciding for itself. A passive one
 *  would ignore these: it holds a standing permission open for a car that
 *  commands itself, and that car's own card is where the commands land. */
function ModeToggle(
  { mode, commandPending, unconfigured, onChangeMode }: {
    mode: ChargingPointMode;
    commandPending: string | false;
    unconfigured: boolean;
    onChangeMode: (mode: ChargingPointMode) => void;
  },
) {
  return (
    <div className={layout.modeToggle}>
      {MODE_BUTTONS.map((btn) => (
        <Button
          key={btn.value}
          variant={mode === btn.value ? "solid" : "outline"}
          color={mode === btn.value ? btn.color : "gray"}
          size="1"
          // No adapter, nothing to command.
          disabled={commandPending !== false || unconfigured}
          onClick={() => onChangeMode(btn.value)}
        >
          {commandPending === `mode:${btn.value}` ? <Spinner /> : null}
          {btn.label}
        </Button>
      ))}
    </div>
  );
}

/** "Settings" as a link to the Chargers section, where the charger row's
 *  vehicle dropdown is. Falls back to plain text when the host gave us nowhere
 *  to navigate, so the sentence still reads. */
function SettingsLink(
  { onNavigateSettings }: { onNavigateSettings?: () => void },
) {
  if (!onNavigateSettings) return <>Settings</>;
  return (
    <Link
      href="#"
      onClick={(event) => {
        event.preventDefault();
        onNavigateSettings();
        revealSettingsSection(CHARGERS_ANCHOR_ID);
      }}
    >
      Settings
    </Link>
  );
}

export function ChargerCard(
  {
    id,
    name,
    mode,
    state,
    solarW,
    gridW,
    controllerDetail,
    controllerReason = null,
    vehicleResolution,
    resolvedVehicleName,
    allocationStatus = null,
    identifier,
    onNavigateSettings,
    controlOwner = "self",
    passiveForVehicleName = null,
  }: {
    id: string;
    name: string;
    mode: ChargingPointMode;
    state: ChargerState | null;
    solarW: number;
    gridW: number;
    controllerDetail: string | null;
    /** Reason behind `controllerDetail`. A reason with user-facing phrasing
     *  gets the same formatted row the vehicle card uses; anything else falls
     *  back to the raw detail below. */
    controllerReason?: string | null;
    /** "ambiguous" (several cars plugged in, none assigned) is the only kind
     *  worth a card warning; "linked" and "inferred" name the car instead,
     *  and the rest have nothing to say. */
    vehicleResolution: VehicleResolutionKind;
    /** Name of the car `vehicleResolution` resolved to, null when it resolved
     *  to nothing, the vehicle is not in the list, or another point is already
     *  showing that car's card — two chargers can infer the same car when only
     *  one is plugged in, and only the one holding its card may claim it. */
    resolvedVehicleName: string | null;
    /** Priority-charging status for this point. It lives here rather than on
     *  the car's card because a paired card is read-only and drops its whole
     *  charge-detail block. */
    allocationStatus?: string | null;
    /** The charge point's own id (OCPP's charge point id), null when the
     *  adapter has none. The heading is often just the plugin's label, so this
     *  is the only thing saying which physical charger the card is. */
    identifier: string | null;
    /** Same convention the vehicle cards use. Absent means the host has no
     *  settings route, and the warning degrades to plain text. */
    onNavigateSettings?: () => void;
    /** "vehicle_api" means this charger is passive: it has been opened to its
     *  maximum and started once for a car that commands itself, and it decides
     *  nothing until that car leaves. Its mode buttons would be ignored, so it
     *  does not offer them. The live readings stay — this is where the meter
     *  is. */
    controlOwner?: ControlOwner;
    /** The self-driving car a passive charger is passing current to. */
    passiveForVehicleName?: string | null;
  },
) {
  const { commandPending, changeMode } = useChargerCommands(id);
  const unconfigured = state?.status === "unconfigured";
  const passive = controlOwner === "vehicle_api";
  // A passive charger is not deciding, so it cannot be stuck for want of a
  // decision: the car on it commands itself and is charging fine.
  const ambiguous = vehicleResolution === "ambiguous" && !passive;
  const vehicleText = vehicleLine(
    controlOwner,
    passiveForVehicleName,
    vehicleResolution,
    resolvedVehicleName,
  );
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
          {identifier && (
            <Badge variant="soft" size="1" title="Charge point id">
              {identifier}
            </Badge>
          )}
        </div>
        <Badge
          variant="soft"
          color={state ? STATUS_BADGE_COLORS[state.status] : "gray"}
        >
          {state ? STATUS_LABELS[state.status] : "Connecting"}
        </Badge>
      </div>

      {!passive && (
        <ModeToggle
          mode={mode}
          commandPending={commandPending}
          unconfigured={unconfigured}
          onChangeMode={changeMode}
        />
      )}

      <div className={layout.status}>
        <StatusIcon state={state} />
        <Text size="2">{getStatusText(state, mode, passive)}</Text>
      </div>

      <div className={layout.details}>
        {unconfigured && (
          <DetailRow icon={Settings}>
            Open charger settings to finish setup
          </DetailRow>
        )}
        {!unconfigured && ambiguous && (
          <DetailRow icon={TriangleAlert} color="yellow">
            Two vehicles are plugged in — nothing will charge until you assign a
            vehicle to this charger in{" "}
            <SettingsLink onNavigateSettings={onNavigateSettings} />
          </DetailRow>
        )}
        {!unconfigured && vehicleText && (
          <DetailRow icon={Car}>{vehicleText}</DetailRow>
        )}
        {allocationStatus && (
          <DetailRow icon={ArrowUpDown} color="yellow">
            {allocationStatus}
          </DetailRow>
        )}
        {/* Nothing has reported yet, so "not charging" would be a guess. */}
        {state && !unconfigured && (
          <DetailRow icon={Zap}>
            {state.isCharging
              ? ampsRange(state.chargeAmps ?? 0, state.chargeAmpsMax)
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
        <ControllerReasonRow
          reason={controllerReason}
          detail={controllerDetail}
        />
        {!isVisibleReason(controllerReason) && controllerDetail && (
          <DetailRow icon={Activity}>{controllerDetail}</DetailRow>
        )}
        <DeviceStatusRow state={state} />
      </div>
    </Card>
  );
}
