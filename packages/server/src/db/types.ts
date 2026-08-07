import type {
  ChargerKind,
  ChargingPointMode,
  ControllerAction,
  DayOfWeek,
  ScheduleType,
  VehicleAdapterType,
  VehicleMode,
} from "@chargeha/shared";
import type { ControllerConfig } from "@chargeha/shared/engine";

/** Structure of the JSON stored in the system_alert config key. */
export interface SystemAlert {
  message: string;
  timestamp: string;
  vehicleId: string;
  vehicleName: string;
}

// The row shapes themselves live in shared: plugins receive them through the
// plugin contract, and the host must not import the plugin package to describe
// its own data.
export type { ChargerRow, VehicleRow } from "@chargeha/shared";

export interface UpsertVehicleInput {
  id: string;
  name: string;
  adapterType: VehicleAdapterType;
  priority: number;
  config: string;
  mode: VehicleMode;
}

/**
 * Upsert payload for a charger row.
 *
 * Deliberately carries NO secrets field. Secrets live in the encrypted
 * `charger_secrets` column and are written only through
 * `AppDatabase.setChargerSecrets` / `patchChargerSecrets`, so a plain upsert
 * (rename, reorder, mode change) can never clobber them and no caller can
 * accidentally log a payload containing credentials.
 */
export interface UpsertChargerInput {
  id: string;
  name: string;
  chargerAdapterType: string;
  /** Serialized `ChargerConfigMap`. Omitted leaves the stored value alone on
   *  update, and defaults to `"{}"` on insert. */
  chargerConfig?: string;
  mode?: ChargingPointMode;
  priority?: number;
  vehicleId?: string | null;
  kind?: ChargerKind;
  active?: boolean;
}

export interface ScheduleRow {
  id: string;
  vehicleId: string | null;
  chargerId: string | null;
  scheduleType: ScheduleType;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  chargeAmps: number | null;
  chargeLimitPct: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  id: string;
  vehicleId: string | null;
  chargerId: string | null;
  scheduleType: ScheduleType;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  chargeAmps: number | null;
  chargeLimitPct: number | null;
  enabled?: boolean;
}

export interface VehicleChargeReadingInput {
  vehicleId: string;
  chargePowerW: number;
  chargeAmps: number;
  batteryLevel: number | null;
  solarContributionW: number;
  gridContributionW: number;
  isHome: boolean;
  ratePerKwh?: number | null;
}

export interface VehiclePollLogInput {
  vehicleId: string;
  vehicleName: string;
  isOnline: boolean;
  isPluggedIn: boolean;
  isCharging: boolean;
  batteryLevel: number;
  chargeLimit: number;
  chargeAmps: number;
  chargeAmpsMax: number;
  chargePowerKw: number;
  chargerVoltage: number;
  energyAddedKwh: number;
  minutesToFull: number;
  isHome: boolean;
}

export interface ControllerLogInput {
  vehicleId: string;
  vehicleName: string;
  mode: VehicleMode;
  inputsJson: string;
  checksJson: string;
  action: ControllerAction;
  actionDetail: string;
  targetAmps: number | null;
  traceId: string | null;
}

export interface ControllerLogRow {
  id: number;
  timestamp: string;
  vehicleId: string;
  vehicleName: string;
  mode: VehicleMode;
  inputsJson: string;
  checksJson: string;
  action: ControllerAction;
  actionDetail: string;
  targetAmps: number | null;
  traceId: string | null;
}

export interface PluginLogInput {
  pluginId: string;
  level: string;
  message: string;
  payload?: string | null;
  origin?: string | null;
  traceId?: string | null;
}

export interface PluginLogRow {
  id: number;
  timestamp: string;
  pluginId: string;
  level: string;
  message: string;
  payload: string | null;
  origin: string | null;
  traceId: string | null;
}

export interface TariffPeriodRow {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  ratePerKwh: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTariffPeriodInput {
  label: string;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  ratePerKwh: number;
  enabled?: boolean;
}

export interface LocalUserRow {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocalUserInput {
  username: string;
  passwordHash: string;
}

export interface OidcConfigRow {
  id: number;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  isEncrypted: boolean;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertOidcConfigInput {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  isEncrypted: boolean;
  baseUrl: string;
}

export interface EnergySummary {
  solarWh: number;
  gridImportWh: number;
  gridExportWh: number;
}

export interface EnergyReadingRow {
  id: number;
  timestamp: string;
  solarProductionW: number;
  gridPowerW: number;
  homeConsumptionW: number;
  batteryPowerW: number | null;
  batterySoc: number | null;
  ratePerKwh: number | null;
}

export interface VehicleChargeReadingRow {
  id: number;
  timestamp: string;
  vehicleId: string;
  chargePowerW: number;
  chargeAmps: number;
  batteryLevel: number | null;
  solarContributionW: number;
  gridContributionW: number;
  isHome: boolean;
  ratePerKwh: number | null;
}

export interface VehiclePollLogRow {
  id: number;
  timestamp: string;
  vehicleId: string;
  vehicleName: string;
  isOnline: boolean;
  isPluggedIn: boolean;
  isCharging: boolean;
  batteryLevel: number;
  chargeLimit: number;
  chargeAmps: number;
  chargeAmpsMax: number;
  chargePowerKw: number;
  chargerVoltage: number;
  energyAddedKwh: number;
  minutesToFull: number;
}

export interface RecentStateChange {
  vehicleId: string;
  vehicleName: string;
  action: ControllerAction;
  timestamp: string;
}

/** Session row. createdAt/expiresAt are epoch seconds (not ms) to avoid
 *  @db/sqlite's 32-bit integer truncation for values > 2^31. */
export interface SessionRow {
  id: string;
  authType: string;
  identifier: string;
  email: string | null;
  createdAt: number;
  expiresAt: number;
}

/** Create session input. createdAt/expiresAt are epoch seconds (not ms). */
export interface CreateSessionInput {
  id: string;
  authType: string;
  identifier: string;
  email?: string | null;
  createdAt: number;
  expiresAt: number;
}

/** Structured inputs snapshot captured each decision cycle. Persisted as
 *  controller_logs.inputs_json, so it belongs with the row types rather than
 *  with the service that produces it — db must never import from services. */
export interface DecisionInputs {
  energy: {
    solarProductionW: number;
    gridPowerW: number;
    homeConsumptionW: number;
    batterySoc: number | null;
    // Absent (undefined) on rows written before this field was added — treat
    // missing the same as null, not as "no battery power right now".
    batteryPowerW?: number | null;
  } | null;
  vehicleState: {
    isPluggedIn: boolean;
    isCharging: boolean;
    batteryLevel: number;
    chargeLimit: number;
    chargeAmps: number;
    chargeAmpsMin: number;
    chargeAmpsMax: number;
    chargePowerKw: number;
    latitude: number | null;
    longitude: number | null;
  } | null;
  config: ControllerConfig;
  activeSchedules: Array<{
    id: string;
    type: string;
    startTime: string;
    endTime: string;
  }>;
}
