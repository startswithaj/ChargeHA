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
  chargerPhases: number; // Number of phases (1 or 3)
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
  /** Establish connection to the energy source. */
  connect(): Promise<void>;

  /** Clean up connection. */
  disconnect(): Promise<void>;

  /** Returns current energy state. */
  getRealtimeData(): Promise<EnergyData>;

  /** Returns adapter/device identification info. */
  getDeviceInfo(): Promise<DeviceInfo>;

  /** Recommended polling interval in seconds. */
  pollIntervalSeconds(): number;
}

/** Per-call metadata threaded through adapter + middleware layers.
 *  `origin` is a caller-chosen tag (e.g. `controller:grace_period:set-amps`);
 *  `traceId` groups all calls made within one logical operation (one
 *  controller loop iteration, one user action) so logs can be correlated. */
export interface CallContext {
  origin: string;
  traceId: string;
}

/** Mint a new traceId. Callers that don't have an upstream trace should
 *  create one at the top of their operation so all downstream logs group. */
export function createTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface VehicleAdapter {
  /** Establish connection / authenticate with vehicle API. */
  connect(ctx: CallContext): Promise<void>;

  /** Clean up connection. */
  disconnect(): Promise<void>;

  /** Returns current charging state. */
  getChargeState(ctx: CallContext): Promise<AdapterVehicleChargeState>;

  /** Start charging. Returns true on success. */
  startCharging(ctx: CallContext): Promise<boolean>;

  /** Stop charging. Returns true on success. */
  stopCharging(ctx: CallContext): Promise<boolean>;

  /** Set charging amperage. Returns true on success. */
  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean>;

  /** Set charge limit percentage. Returns true on success. */
  setChargeLimit(percent: number, ctx: CallContext): Promise<boolean>;

  /** Wake the vehicle if asleep. Returns true when online. */
  wakeVehicle(ctx: CallContext): Promise<boolean>;

  /** Check if vehicle is currently online/reachable. */
  isVehicleOnline(ctx: CallContext): Promise<boolean>;

  /** Returns simulation controls if this adapter supports simulation. */
  getSimulationControls?(): SimulationControls | null;
}

export interface SimulationControls {
  setSocPercent(value: number): void;
  setPluggedIn(value: boolean): void;
  setLocation(lat: number, lng: number): void;
}

// ---- Schedule Types ----

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type ScheduleType = "charge" | "blockout";

export interface ChargeSchedule {
  id: string;
  vehicleId: string;
  scheduleType: "charge";
  startTime: string; // HH:MM 24h format
  endTime: string; // HH:MM 24h format
  days: DayOfWeek[];
  chargeAmps: number;
  chargeLimitPct: number;
  enabled: boolean;
}

export interface BlockoutSchedule {
  id: string;
  vehicleId: null;
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
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  chargeAmps: number;
  chargeLimitPct: number;
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

/** Central definition of all notification events — used by both server and client. */
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

// ---- WebSocket Message Types ----

/**
 * Discriminated union for all SSE events sent over the single subscription.
 *
 * WHY A SINGLE SUBSCRIPTION:
 * tRPC's httpSubscriptionLink opens one EventSource (HTTP long-lived connection)
 * per useSubscription() call. Browsers limit HTTP/1.1 to 6 concurrent connections
 * per origin (Chromium, Firefox). With multiple subscriptions, each holds a
 * connection permanently. React StrictMode in development double-mounts components,
 * briefly doubling the connection count. With 3 subscriptions × 2 mounts = 6
 * connections, Chrome's entire pool is exhausted — page refresh hangs because the
 * new document request has no available connection slot.
 *
 * Even in production (no StrictMode), 3+ subscriptions leaves only 3 connection
 * slots for all other requests (API calls, static assets), and adding any future
 * subscription would push past the limit.
 *
 * The solution: multiplex all real-time events over a single SSE connection using
 * a discriminated union. The server emits tagged events, the client routes them
 * by `type`. One connection, fully typed, no pool issues.
 *
 * HTTP/2 would also solve this (100+ multiplexed streams), but Deno.serve only
 * supports HTTP/2 over TLS, and the app runs on plain HTTP behind a reverse proxy.
 */
export type SSEEvent =
  | { type: "energy_update"; data: EnergyData & CumulativeEnergyData }
  | { type: "vehicle_update"; data: VehicleChargeState }
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
  };

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
