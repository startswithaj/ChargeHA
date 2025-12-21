import { z } from "zod";

// ── Section definition helpers ──────────────────────────────────────────────

type FieldDef<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  key: string;
  schema: T;
  default: z.infer<T>;
};

export type SectionDef = Record<string, FieldDef>;

/**
 * Infer the typed config object from a section definition.
 * E.g. { solarTrackingEnabled: boolean; solarMarginKw: number; ... }
 */
export type SectionType<T extends SectionDef> = {
  [K in keyof T]: z.infer<T[K]["schema"]>;
};

/**
 * Identity function that preserves the exact type of the section definition.
 * The `const` type parameter keeps string literal `key` values from being
 * widened to `string`, so `SectionKeys<typeof def>` resolves to a real union.
 */
export function defineSection<const T extends SectionDef>(def: T): T {
  return def;
}

// ── Core section definitions ────────────────────────────────────────────────

export const chargingConfigDef = defineSection({
  chargingEnabled: {
    key: "charging_enabled",
    schema: z.boolean(),
    default: true,
  },
  priorityChargingEnabled: {
    key: "priority_charging_enabled",
    schema: z.boolean(),
    default: false,
  },
});
export type ChargingConfig = SectionType<typeof chargingConfigDef>;

export const solarConfigDef = defineSection({
  solarTrackingEnabled: {
    key: "solar_tracking_enabled",
    schema: z.boolean(),
    default: true,
  },
  solarTrackingMode: {
    key: "solar_tracking_mode",
    schema: z.enum(["solar_only", "solar_grid"]),
    default: "solar_only" as const,
  },
  solarReference: {
    key: "solar_reference",
    schema: z.enum(["excess", "gross"]),
    default: "excess" as const,
  },
  solarMarginKw: {
    key: "solar_margin_kw",
    schema: z.number(),
    default: 0,
  },
  minSolarGenerationKw: {
    key: "min_solar_generation_kw",
    schema: z.number(),
    default: 0.2,
  },
  minExcessSolarKw: {
    key: "min_excess_solar_kw",
    schema: z.number().nullable(),
    default: null,
  },
  gridVoltage: {
    key: "grid_voltage",
    schema: z.number().int(),
    default: 230,
  },
  threePhaseCharger: {
    key: "three_phase_charger",
    schema: z.boolean(),
    default: false,
  },
  consumptionExcludesCharging: {
    key: "consumption_excludes_charging",
    schema: z.boolean(),
    default: false,
  },
  gracePeriodMinutes: {
    key: "grace_period_minutes",
    schema: z.number().int(),
    default: 6,
  },
  cooldownPeriodMinutes: {
    key: "cooldown_period_minutes",
    schema: z.number().int(),
    default: 15,
  },
  ampDebounceThreshold: {
    key: "amp_debounce_threshold",
    schema: z.number().int(),
    default: 2,
  },
  ampDebounceSettleMinutes: {
    key: "amp_debounce_settle_minutes",
    schema: z.number().int(),
    default: 3,
  },
});
export type SolarConfig = SectionType<typeof solarConfigDef>;

export const batteryConfigDef = defineSection({
  batteryPriorityEnabled: {
    key: "battery_priority_enabled",
    schema: z.boolean(),
    default: false,
  },
  batteryPriorityLimit: {
    key: "battery_priority_limit",
    schema: z.number().int(),
    default: 80,
  },
});
export type BatteryConfig = SectionType<typeof batteryConfigDef>;

export const homeConfigDef = defineSection({
  homeLatitude: {
    key: "home_latitude",
    schema: z.number().nullable(),
    default: null,
  },
  homeLongitude: {
    key: "home_longitude",
    schema: z.number().nullable(),
    default: null,
  },
});
export type HomeConfig = SectionType<typeof homeConfigDef>;

export const equipmentConfigDef = defineSection({
  energyAdapterType: {
    key: "energy_adapter_type",
    schema: z.string(),
    default: "",
  },
});
export type EquipmentConfig = SectionType<typeof equipmentConfigDef>;

export const systemConfigDef = defineSection({
  energyErrorThreshold: {
    key: "energy_error_threshold",
    schema: z.number().int(),
    default: 6,
  },
  controllerLoopSeconds: {
    key: "controller_loop_seconds",
    schema: z.number().int(),
    default: 30,
  },
  recordingIntervalSeconds: {
    key: "recording_interval_seconds",
    schema: z.number().int(),
    default: 60,
  },
  timezone: {
    key: "timezone",
    schema: z.string(),
    default: "",
  },
  dataRetentionDays: {
    key: "data_retention_days",
    schema: z.number().int(),
    default: 730,
  },
  logRetentionDays: {
    key: "log_retention_days",
    schema: z.number().int(),
    default: 30,
  },
});
export type SystemConfig = SectionType<typeof systemConfigDef>;

export const notificationConfigDef = defineSection({
  notificationProvider: {
    key: "notification_provider",
    schema: z.string(),
    default: "",
  },
  notificationEnabledEvents: {
    key: "notification_enabled_events",
    schema: z.string(),
    default: "",
  },
  notificationTelegramBotToken: {
    key: "notification_telegram_bot_token",
    schema: z.string(),
    default: "",
  },
  notificationTelegramChatId: {
    key: "notification_telegram_chat_id",
    schema: z.string(),
    default: "",
  },
  notificationTelegramTopicId: {
    key: "notification_telegram_topic_id",
    schema: z.string(),
    default: "",
  },
  notificationTelegramSilent: {
    key: "notification_telegram_silent",
    schema: z.boolean(),
    default: false,
  },
});
export type NotificationConfig = SectionType<typeof notificationConfigDef>;

export const internalConfigDef = defineSection({
  wizardCompleted: {
    key: "wizard_completed",
    schema: z.boolean(),
    default: false,
  },
  systemAlert: {
    key: "system_alert",
    schema: z.string(),
    default: "",
  },
  defaultRatePerKwh: {
    key: "default_rate_per_kwh",
    schema: z.string(),
    default: "",
  },
  currencySymbol: {
    key: "currency_symbol",
    schema: z.string(),
    default: "$",
  },
  currencyCode: {
    key: "currency_code",
    schema: z.string(),
    default: "AUD",
  },
  authMode: {
    key: "auth_mode",
    schema: z.enum(["none", "local", "oidc"]),
    default: "none" as const,
  },
  oscillationTripAt: {
    key: "oscillation_trip_at",
    schema: z.string(),
    default: "",
  },
  wizardStep: {
    key: "wizard_step",
    schema: z.string(),
    default: "",
  },
  wizardVehicleType: {
    key: "wizard_vehicle_type",
    schema: z.string(),
    default: "",
  },
  wizardEnergyType: {
    key: "wizard_energy_type",
    schema: z.string(),
    default: "",
  },
  wizardOidcPending: {
    key: "wizard_oidc_pending",
    schema: z.string(),
    default: "",
  },
});
export type InternalConfig = SectionType<typeof internalConfigDef>;

// ── Derive CoreConfigKey union from core sections ───────────────────────────

/** Collect all DB key strings from a section definition. */
export type SectionKeys<T extends SectionDef> = T[keyof T]["key"];

/** Union of every DB key across core sections. */
export type CoreConfigKey =
  | SectionKeys<typeof chargingConfigDef>
  | SectionKeys<typeof solarConfigDef>
  | SectionKeys<typeof batteryConfigDef>
  | SectionKeys<typeof homeConfigDef>
  | SectionKeys<typeof equipmentConfigDef>
  | SectionKeys<typeof systemConfigDef>
  | SectionKeys<typeof notificationConfigDef>
  | SectionKeys<typeof internalConfigDef>;

/** Runtime list of every core DB key — used by validators that need a
 *  closed set (e.g. tRPC input enums). Kept in sync with CoreConfigKey. */
export const CORE_CONFIG_KEYS: readonly CoreConfigKey[] = [
  ...sectionDbKeys(chargingConfigDef),
  ...sectionDbKeys(solarConfigDef),
  ...sectionDbKeys(batteryConfigDef),
  ...sectionDbKeys(homeConfigDef),
  ...sectionDbKeys(equipmentConfigDef),
  ...sectionDbKeys(systemConfigDef),
  ...sectionDbKeys(notificationConfigDef),
  ...sectionDbKeys(internalConfigDef),
];

// ── ConfigKey ───────────────────────────────────────────────────────────────

/**
 * `ConfigKey` aliases `CoreConfigKey` — every core key is typed as a literal
 * union. Plugin config goes through `PluginDependencies` (with its own
 * per-plugin key union) and `AppDatabase.{get,set}PluginConfig`, which take
 * already-namespaced strings.
 */
export type ConfigKey = CoreConfigKey;

// ── Serialization / Deserialization ─────────────────────────────────────────

/**
 * Deserialize a string value from the KV store into its typed form,
 * based on the Zod schema for that field.
 */
function deserializeValue<T extends z.ZodTypeAny>(
  raw: string | null,
  schema: T,
  defaultValue: z.infer<T>,
): z.infer<T> {
  if (raw === null || raw === undefined) return defaultValue;

  // Unwrap nullable to get the inner type
  const innerSchema = unwrapNullable(schema);
  const isNullable = innerSchema !== schema;

  // Handle nullable — empty string means null
  if (isNullable && raw === "") return null;

  // Check inner type
  if (innerSchema instanceof z.ZodBoolean) {
    return raw === "true";
  }
  if (innerSchema instanceof z.ZodNumber) {
    if (raw === "") return defaultValue;
    const num = parseFloat(raw);
    return isNaN(num) ? defaultValue : num;
  }
  if (innerSchema instanceof z.ZodEnum) {
    // Validate against the enum values
    const result = schema.safeParse(raw);
    return result.success ? result.data : defaultValue;
  }
  // String passthrough
  return raw;
}

/**
 * Serialize a typed value to a string for KV store storage.
 */
function serializeValue<T extends z.ZodTypeAny>(
  value: z.infer<T>,
  _schema: T,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value);
}

/** Unwrap z.nullable() to get the inner schema, or return the schema itself. */
function unwrapNullable(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodNullable) {
    return schema.unwrap();
  }
  return schema;
}

// ── Public serde API ────────────────────────────────────────────────────────

/**
 * Deserialize a full section from string KV pairs into a typed object.
 * `rawValues` maps DB key → string value (or null if not in DB).
 */
export function deserializeSection<T extends SectionDef>(
  sectionDef: T,
  rawValues: Record<string, string | null>,
): SectionType<T> {
  const result = Object.fromEntries(
    Object.entries(sectionDef).map(([propName, field]) => {
      const raw = rawValues[field.key] ?? null;
      return [propName, deserializeValue(raw, field.schema, field.default)];
    }),
  );
  return result as SectionType<T>;
}

/**
 * Serialize a partial typed config object into DB key → string pairs.
 */
export function serializeSection<T extends SectionDef>(
  sectionDef: T,
  values: Partial<SectionType<T>>,
): Record<SectionKeys<T>, string> {
  const result = Object.fromEntries(
    Object.entries(sectionDef)
      .filter(([propName]) => propName in values)
      .map(([propName, field]) => {
        const value = (values as Record<string, unknown>)[propName];
        return [field.key, serializeValue(value, field.schema)];
      }),
  );
  return result as Record<SectionKeys<T>, string>;
}

/**
 * Get the DB keys for a section definition, typed as the literal union.
 */
export function sectionDbKeys<T extends SectionDef>(
  sectionDef: T,
): SectionKeys<T>[] {
  return Object.values(sectionDef).map((f) => f.key) as SectionKeys<T>[];
}

/**
 * Get the defaults for a section as DB key → string pairs.
 */
export function sectionDefaults<T extends SectionDef>(
  sectionDef: T,
): Record<string, string> {
  const result = Object.fromEntries(
    Object.values(sectionDef).map((field) => [
      field.key,
      serializeValue(field.default, field.schema),
    ]),
  );
  return result;
}

// ── Build a Zod input schema for per-section mutations ──────────────────────

/**
 * Build a Zod schema for validating partial section input (for mutations).
 * Every field is optional, matching Partial<SectionType<T>>.
 */
export function buildSectionInputSchema<T extends SectionDef>(
  sectionDef: T,
): z.ZodType<Partial<SectionType<T>>> {
  const shape = Object.fromEntries(
    Object.entries(sectionDef).map(([propName, field]) => [
      propName,
      field.schema.optional(),
    ]),
  );
  return z.object(shape) as unknown as z.ZodType<Partial<SectionType<T>>>;
}

// ── Pre-built input schemas for tRPC endpoints ──────────────────────────────

export const chargingConfigInput: z.ZodType<Partial<ChargingConfig>> =
  buildSectionInputSchema(chargingConfigDef);
export const solarConfigInput: z.ZodType<Partial<SolarConfig>> =
  buildSectionInputSchema(solarConfigDef);
export const batteryConfigInput: z.ZodType<Partial<BatteryConfig>> =
  buildSectionInputSchema(batteryConfigDef);
export const homeConfigInput: z.ZodType<Partial<HomeConfig>> =
  buildSectionInputSchema(homeConfigDef);
export const equipmentConfigInput: z.ZodType<Partial<EquipmentConfig>> =
  buildSectionInputSchema(equipmentConfigDef);
export const systemConfigInput: z.ZodType<Partial<SystemConfig>> =
  buildSectionInputSchema(systemConfigDef);
export const notificationConfigInput: z.ZodType<Partial<NotificationConfig>> =
  buildSectionInputSchema(
    notificationConfigDef,
  );
