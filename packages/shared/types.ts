// ---- Energy Data Types ----

export interface EnergyData {
  solarProductionW: number; // Current solar production in watts
  gridPowerW: number; // Grid power in watts (positive=import, negative=export)
  homeConsumptionW: number; // Current home consumption in watts
  batteryPowerW: number | null; // Battery power (positive=discharge, negative=charge)
  batterySoc: number | null; // Battery state of charge (0-100)
  gridVoltageV: number | null; // AC grid voltage (e.g. 230, 240, 120)
  lastUpdated: string; // ISO 8601 timestamp of when this data was fetched
  // Set by EnergyPoller — true when the adapter poll threw and zeros were
  // substituted. Adapters never set this. Defaults to false when omitted.
  pollFailed?: boolean;
  // Set by EnergyPoller alongside pollFailed — the error message shown on the dashboard.
  pollError?: string;
}

export interface CumulativeEnergyData {
  solarProducedWh: number; // Total solar energy produced (Wh)
  gridImportedWh: number; // Total energy imported from grid (Wh)
  gridExportedWh: number; // Total energy exported to grid (Wh)
  dailySolarProducedWh: number; // Today's solar production (Wh)
  dailyGridImportWh: number; // Today's grid import (Wh)
  dailyGridExportWh: number; // Today's grid export (Wh)
}

// ---- Vehicle Mode ----

export type VehicleMode = "auto" | "charge_now" | "stop";

export type VehicleCommand = "start" | "stop" | "wake";

export type VehicleAdapterType = string;

export type ControllerAction = "start" | "stop" | "adjust_amps" | "none";

export type SolarTrackingMode = "solar_only" | "solar_grid";

export type SolarReference = "excess" | "gross";

// ---- Vehicle Types ----

export interface VehicleChargeState {
  vehicleId: string; // Unique ID for this vehicle (VIN)
  batteryLevel: number; // Current SOC percentage (0-100)
  chargeLimit: number; // Charge limit percentage
  isCharging: boolean; // Currently charging
  isPluggedIn: boolean; // Cable connected
  isOnline: boolean; // Vehicle is reachable
  chargeAmps: number; // Current charge amperage
  chargeAmpsMax: number; // Maximum available amps
  chargeAmpsMin: number; // Minimum charge amps (hardware limit)
  chargePowerKw: number; // Current charge power in kW
  chargerVoltage: number; // Charger voltage
  chargerPhases: number | null; // Phases (1 or 3); null = not reported
  energyAddedKwh: number; // Energy added this session
  minutesToFull: number; // Estimated minutes to charge limit
  chargePortOpen: boolean; // Charge port door open
  vehicleName: string; // Vehicle display name
  lastUpdated: string; // ISO 8601 timestamp of when this state was fetched
  latitude: number | null; // GPS latitude (null if unavailable)
  longitude: number | null; // GPS longitude (null if unavailable)
  isHome: boolean | null; // computed by VehicleManager; null = unknown
}

export type AdapterVehicleChargeState = Omit<VehicleChargeState, "isHome">;

// ---- Vehicle With State (used by client components) ----

export interface VehicleWithState {
  id: string;
  name: string;
  adapterType: string;
  priority: number;
  config: string;
  mode: string;
  state: VehicleChargeState | null;
  lastLocation?: { latitude: number; longitude: number } | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  pollingSuspended?: boolean;
  pollingSuspendReason?: string | null;
}

// ---- Device Info ----

export interface DeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
}

// ---- Adapter Interfaces ----

export interface EnergySourceAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getRealtimeData(): Promise<EnergyData>;
  getDeviceInfo(): Promise<DeviceInfo>;
  pollIntervalSeconds(): number;
}

// `origin` is a caller-chosen tag (e.g. `controller:grace_period:set-amps`);
// `traceId` groups all calls made within one logical operation so logs can be correlated.
export interface CallContext {
  origin: string;
  traceId: string;
}

// Callers that don't have an upstream trace should create one at the top
// of their operation so all downstream logs group.
export function createTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface VehicleAdapter {
  connect(ctx: CallContext): Promise<void>;
  disconnect(): Promise<void>;
  getChargeState(ctx: CallContext): Promise<AdapterVehicleChargeState>;
  setChargeLimit(percent: number, ctx: CallContext): Promise<boolean>;
  wakeVehicle(ctx: CallContext): Promise<boolean>;
  isVehicleOnline(ctx: CallContext): Promise<boolean>;
  getSimulationControls?(): SimulationControls | null;
}

export interface SimulationControls {
  setSocPercent(value: number): void;
  setPluggedIn(value: boolean): void;
  setLocation(lat: number, lng: number): void;
}

// ---- Charger Types ----

export type ChargerControlMode = "amps" | "switch";

// A smart charger controls whatever is plugged into it; a vehicle-API
// charging point drives one specific car through its own API.
export type ChargerKind = "smart" | "vehicle_api";

export type VehicleResolutionKind =
  | "linked"
  | "inferred"
  | "ambiguous"
  | "none";

export type ChargerStatus =
  | "available"
  | "preparing"
  | "charging"
  | "suspended"
  | "faulted"
  | "finishing"
  | "no_draw"
  // No adapter was ever created for this charging point — its config is
  // missing or was rejected. Nothing behind it to report on.
  | "unconfigured";

export interface ChargerState {
  chargerId: string;
  isCharging: boolean;
  // null = this charger type cannot observe cable state (smart plugs).
  isPluggedIn: boolean | null;
  // Measured fields: null = not measured, never zero. Core derives amps
  // from measured watts when null (see ChargingPointManager).
  chargeAmps: number | null;
  chargeAmpsMax: number;
  chargeAmpsMin: number;
  chargePowerKw: number | null;
  chargerVoltage: number | null;
  chargerPhases: number | null;
  energyAddedKwh: number;
  status: ChargerStatus;
  // The adapter's native status, as close to the device as possible.
  statusDetail: string | null;
  // Whether this charger accepts an amperage setpoint or is on/off only.
  controlMode: ChargerControlMode;
  lastUpdated: string;
}

export interface ChargerAdapter {
  // No connect(): adapters reach their device lazily on first use — an
  // offline device can never block startup. Setup-time validation lives in
  // each plugin's testConnection procedure.
  disconnect(): Promise<void>;
  startCharging(ctx: CallContext): Promise<boolean>;
  stopCharging(ctx: CallContext): Promise<boolean>;
  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean>;
  getChargerState(ctx: CallContext): Promise<ChargerState>;
  // null = push-based (no polling); a number = min seconds between fetches.
  pollIntervalSeconds(): number | null;
}

// Charging point mode reuses the existing values ("auto"|"charge_now"|"stop").
export type ChargingPointMode = VehicleMode;

// ---- Schedule Types ----

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type ScheduleType = "charge" | "blockout";

export interface ChargeSchedule {
  id: string;
  vehicleId: string | null;
  chargerId: string | null;
  scheduleType: "charge";
  startTime: string; // HH:MM 24h format
  endTime: string; // HH:MM 24h format
  days: DayOfWeek[];
  chargeAmps: number;
  // Null for charger-keyed schedules — no battery visibility.
  chargeLimitPct: number | null;
  enabled: boolean;
}

export interface BlockoutSchedule {
  id: string;
  vehicleId: null;
  chargerId: null;
  scheduleType: "blockout";
  startTime: string; // HH:MM 24h format
  endTime: string; // HH:MM 24h format
  days: DayOfWeek[];
  enabled: boolean;
}

export type Schedule = ChargeSchedule | BlockoutSchedule;

export interface ScheduleFormData {
  scheduleType: ScheduleType;
  vehicleId: string | null;
  chargerId: string | null;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  chargeAmps: number;
  chargeLimitPct: number | null;
}

// ---- Notification Types ----

export type NotificationEventType =
  | "error"
  | "energy_recovered"
  | "charge_started"
  | "charge_stopped"
  | "charge_complete"
  | "external_charge_detected"
  | "vehicle_plugged_in"
  | "vehicle_unplugged"
  | "vehicle_sleep"
  | "low_solar"
  | "schedule_activated"
  | "safety_trip"
  | "mode_changed"
  | "arrived_home_not_plugged_in";

export interface NotificationEventInfo {
  key: NotificationEventType;
  label: string;
  description: string;
}

// Central definition of all notification events — used by both server and client.
export const NOTIFICATION_EVENTS: NotificationEventInfo[] = [
  {
    key: "error",
    label: "Errors",
    description: "Adapter or connection failures",
  },
  {
    key: "energy_recovered",
    label: "Energy Recovered",
    description: "Energy source came back online after an outage",
  },
  {
    key: "charge_started",
    label: "Charge Started",
    description: "Controller initiated charging",
  },
  {
    key: "charge_stopped",
    label: "Charge Stopped",
    description: "Controller stopped charging",
  },
  {
    key: "charge_complete",
    label: "Charge Complete",
    description: "Vehicle reached its charge limit",
  },
  {
    key: "external_charge_detected",
    label: "External Charge Detected",
    description: "Vehicle charging was not initiated by ChargeHA",
  },
  {
    key: "vehicle_plugged_in",
    label: "Vehicle Plugged In",
    description: "Cable connected to vehicle",
  },
  {
    key: "vehicle_unplugged",
    label: "Vehicle Unplugged",
    description: "Cable disconnected from vehicle",
  },
  {
    key: "vehicle_sleep",
    label: "Vehicle Asleep",
    description: "Vehicle is asleep or offline (not an error)",
  },
  {
    key: "low_solar",
    label: "Low Solar",
    description:
      "Solar dropped below threshold, grace period started (can be noisy)",
  },
  {
    key: "schedule_activated",
    label: "Schedule Activated",
    description: "A charge or blockout schedule became active",
  },
  {
    key: "safety_trip",
    label: "Safety Trip",
    description: "Charging disabled due to charge oscillation detected",
  },
  {
    key: "mode_changed",
    label: "Mode Changed",
    description: "Vehicle mode switched (Auto / Charge Now / Stop)",
  },
  {
    key: "arrived_home_not_plugged_in",
    label: "Plug-in Reminder",
    description:
      "Reminds you to plug in when you arrive home below the charge target",
  },
];

export const MANDATORY_NOTIFICATION_EVENTS: ReadonlySet<NotificationEventType> =
  new Set(["safety_trip"]);

// ---- WebSocket Message Types ----

// Single SSE subscription multiplexing all real-time events. Multiple
// useSubscription() calls exhaust the browser's 6-connection HTTP/1.1 pool.
// See docs/realtime.md for the full reasoning.
export type SSEEvent =
  | { type: "energy_update"; data: EnergyData & CumulativeEnergyData }
  | { type: "vehicle_update"; data: VehicleChargeState }
  | { type: "vehicles_changed"; data: Record<string, never> }
  | {
    type: "vehicle_error";
    data: { vehicleId: string; vehicleName: string; error: string | null };
  }
  | {
    type: "controller_status";
    data: {
      vehicleId: string;
      action: string;
      reason: string;
      detail: string;
      targetAmps: number | null;
      checksJson: string;
    };
  }
  | { type: "charger_update"; data: ChargerState & { chargerName: string } }
  | { type: "chargers_changed"; data: Record<string, never> };

// ---- Timestamped wrapper for API responses ----

export interface EnergySnapshot {
  timestamp: string; // ISO 8601
  realtime: EnergyData;
  cumulative: CumulativeEnergyData;
}

// ---- Stats Types ----

export type StatsPeriod = "day" | "month" | "year";

export interface StatsBucket {
  label: string; // "0"-"23" (day), "1"-"31" (month), "Jan"-"Dec" (year)
  solarWh: number; // Solar energy used for home charging in this bucket
  gridWh: number; // Grid energy used for home charging in this bucket
  awayWh: number; // Energy charged away from home in this bucket
  totalWh: number; // solarWh + gridWh + awayWh
  costCents?: number; // Grid charging cost in cents (only when tariff rates exist)
}

export interface EnergyBucket {
  label: string;
  solarProductionWh: number; // Total solar produced in this bucket
  solarWh: number; // Solar self-consumed in this bucket
  gridWh: number; // Grid imported in this bucket
  totalWh: number; // Total home consumption
  costCents?: number; // Grid import cost in cents (only when tariff rates exist)
  solarSavingsCents?: number; // Solar self-consumption savings in cents
}

export interface SolarProductionPoint {
  x: number; // Numeric position on the X-axis (e.g. 10.25 = 10:15 for day view)
  solarProductionKwh: number;
}

export interface StatsResponse {
  period: StatsPeriod;
  startDate: string;
  endDate: string;

  // Home energy data (from energy_readings — always populated)
  energyBuckets: EnergyBucket[];
  homeSolarProductionWh: number;
  homeConsumedWh: number;
  homeSolarWh: number;
  homeGridWh: number;
  homeSelfPoweredPercent: number;

  // Fine-grained solar production line (higher resolution than energyBuckets)
  solarProductionLine: SolarProductionPoint[];

  // Vehicle charging data (from vehicle_charge_readings — populated when vehicles have charged)
  buckets: StatsBucket[];
  totalChargedWh: number; // Total energy charged across all sources
  totalSolarWh: number;
  totalGridWh: number;
  totalAwayWh: number; // Total energy charged away from home
  selfPoweredPercent: number;

  // Cost data (from tariff rates on charge readings — only meaningful when rates have been recorded)
  totalCostCents?: number; // Total grid charging cost in cents
  solarSavingsCents?: number; // Total solar savings in cents (home + EV)
  evSolarSavingsCents?: number; // EV-only solar savings in cents
  currencySymbol?: string; // e.g. '$'
  currencyCode?: string; // e.g. 'AUD'
  tariffBreakdown?: TariffBreakdownEntry[]; // Per-rate cost breakdown

  // Vehicle battery levels per bucket (day view only — indexed same as buckets[])
  vehicleSoc?: VehicleSocSnapshot[][];
}

export interface TariffBreakdownEntry {
  label: string; // Tariff period label (e.g. "Off-Peak", "Peak") or rate description
  ratePerKwh: number;
  gridWh: number; // Grid energy charged at this rate
  costCents: number; // Grid cost at this rate
}

export interface VehicleSocSnapshot {
  vehicleId: string;
  vehicleName: string;
  batteryLevel: number; // 0-100 percentage
}

// ---- Wizard Navigation State ----

// Where the setup wizard is, and the selections that decide which steps
// exist. Read and written as one record so the step id can never name a
// step the current selections haven't put in the list.
export interface WizardNavState {
  // null = wizard not started (the old "" sentinel, retired).
  stepId: string | null;
  // null = not selected. The existing "" sentinels migrate to null; the
  // WizardService data layer maps null ↔ absent config key (code.md: no empty-string sentinels).
  vehicleType: string | null;
  energyType: string | null;
  chargerType: string | null;
  // The installation's control-path decision. null = the question has not
  // been answered — the wizard blocks until it is. Migration writes "vehicle" once for existing installs.
  controlPath: "charger" | "vehicle" | null;
}

// Persisted vehicle. Lives here rather than in the db layer because
// plugins receive it through the plugin contract.
export interface VehicleRow {
  id: string;
  name: string;
  adapterType: VehicleAdapterType;
  priority: number;
  config: string;
  mode: VehicleMode;
  createdAt: string;
  updatedAt: string;
}

// Persisted charging point. Handed to charger plugins, hence shared.
export interface ChargerRow {
  id: string;
  name: string;
  chargerAdapterType: string;
  chargerConfig: string;
  mode: ChargingPointMode;
  priority: number;
  vehicleId: string | null;
  kind: ChargerKind;
  // Inactive points keep their row (and schedules) but are not controlled.
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// Non-secret, row-scoped plugin config. Values are strings so the shape
// matches the plugin config store's `string | null` contract; absence of a key means "not set" — never `""`.
export type ChargerConfigMap = Readonly<Record<string, string>>;

// Secret, row-scoped plugin config. Same shape as `ChargerConfigMap`, but
// persisted to the encrypted `charger_secrets` column and never placed on `ChargerRow`.
export type ChargerSecretsMap = Readonly<Record<string, string>>;

// A patch applied to a row's config or secrets. `null` deletes the key.
export type ChargerConfigPatch = Readonly<Record<string, string | null>>;
