import { z } from "zod";
import {
  type ConfigKey,
  CORE_CONFIG_KEYS,
  type CoreConfigKey,
} from "./configSections.ts";

// Re-export config types from configSections (single source of truth)
export { type ConfigKey, type CoreConfigKey };

// ---- Shared enums / primitives ----

const dayOfWeekSchema: z.ZodEnum<
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
> = z.enum([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);
export type DayOfWeekZ = z.infer<typeof dayOfWeekSchema>;

const vehicleModeSchema: z.ZodEnum<["auto", "charge_now", "stop"]> = z.enum([
  "auto",
  "charge_now",
  "stop",
]);
export type VehicleModeZ = z.infer<typeof vehicleModeSchema>;

const vehicleAdapterTypeSchema: z.ZodString = z.string().min(1);
export type VehicleAdapterTypeZ = z.infer<typeof vehicleAdapterTypeSchema>;

const scheduleTypeSchema: z.ZodEnum<["charge", "blockout"]> = z.enum([
  "charge",
  "blockout",
]);
export type ScheduleTypeZ = z.infer<typeof scheduleTypeSchema>;

const statsPeriodSchema: z.ZodEnum<["day", "month", "year"]> = z.enum([
  "day",
  "month",
  "year",
]);
export type StatsPeriodZ = z.infer<typeof statsPeriodSchema>;

const timeStringSchema: z.ZodString = z.string().regex(
  /^\d{2}:\d{2}$/,
  "Expected HH:MM",
);

// ConfigKey and CoreConfigKey are re-exported from configSections above

// ---- Stats inputs ----

export const statsDayInput: z.ZodType<{
  date: string;
  tz?: number | undefined;
  vehicleId?: string | undefined;
  resolution?: "15m" | undefined;
}> = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  tz: z.number().min(-14).max(14).optional(),
  vehicleId: z.string().optional(),
  resolution: z.enum(["15m"]).optional(),
});
export type StatsDayInput = z.infer<typeof statsDayInput>;

export const statsMonthInput: z.ZodType<{
  year: number;
  month: number;
  tz?: number | undefined;
  vehicleId?: string | undefined;
}> = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  tz: z.number().min(-14).max(14).optional(),
  vehicleId: z.string().optional(),
});
export type StatsMonthInput = z.infer<typeof statsMonthInput>;

export const statsYearInput: z.ZodType<{
  year: number;
  tz?: number | undefined;
  vehicleId?: string | undefined;
}> = z.object({
  year: z.number().int(),
  tz: z.number().min(-14).max(14).optional(),
  vehicleId: z.string().optional(),
});
export type StatsYearInput = z.infer<typeof statsYearInput>;

// ---- Energy inputs ----

export const energyHistoryInput: z.ZodType<{
  limit?: number | undefined;
}> = z.object({
  limit: z.number().int().min(1).optional(),
});
export type EnergyHistoryInput = z.infer<typeof energyHistoryInput>;

// ---- Vehicle inputs ----

export const vehicleIdInput: z.ZodType<{
  vehicleId: string;
}> = z.object({
  vehicleId: z.string(),
});
export type VehicleIdInput = z.infer<typeof vehicleIdInput>;

export const vehicleCreateInput: z.ZodType<{
  id: string;
  name: string;
  adapterType: VehicleAdapterTypeZ;
  priority?: number | undefined;
  config?: string | undefined;
  mode?: VehicleModeZ | undefined;
}> = z.object({
  id: z.string(),
  name: z.string(),
  adapterType: vehicleAdapterTypeSchema,
  priority: z.number().optional(),
  config: z.string().optional(),
  mode: vehicleModeSchema.optional(),
});
export type VehicleCreateInput = z.infer<typeof vehicleCreateInput>;

export const vehicleSetModeInput: z.ZodType<{
  vehicleId: string;
  mode: VehicleModeZ;
}> = z.object({
  vehicleId: z.string(),
  mode: vehicleModeSchema,
});
export type VehicleSetModeInput = z.infer<typeof vehicleSetModeInput>;

export const vehicleSetPriorityInput: z.ZodType<{
  vehicleId: string;
  priority: number;
}> = z.object({
  vehicleId: z.string(),
  priority: z.number(),
});
export type VehicleSetPriorityInput = z.infer<typeof vehicleSetPriorityInput>;

export const vehicleCommandInput: z.ZodType<{
  vehicleId: string;
  command: "start" | "stop" | "wake";
}> = z.object({
  vehicleId: z.string(),
  command: z.enum(["start", "stop", "wake"]),
});
export type VehicleCommandInput = z.infer<typeof vehicleCommandInput>;

export const vehicleSetAmpsInput: z.ZodType<{
  vehicleId: string;
  amps: number;
}> = z.object({
  vehicleId: z.string(),
  amps: z.number(),
});
export type VehicleSetAmpsInput = z.infer<typeof vehicleSetAmpsInput>;

export const vehicleSetChargeLimitInput: z.ZodType<{
  vehicleId: string;
  percent: number;
}> = z.object({
  vehicleId: z.string(),
  percent: z.number(),
});
export type VehicleSetChargeLimitInput = z.infer<
  typeof vehicleSetChargeLimitInput
>;

export const vehicleSimulateInput: z.ZodType<{
  vehicleId: string;
  isPluggedIn?: boolean | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  chargeLimit?: number | undefined;
  socPercent?: number | undefined;
}> = z.object({
  vehicleId: z.string(),
  isPluggedIn: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  chargeLimit: z.number().optional(),
  socPercent: z.number().optional(),
});
export type VehicleSimulateInput = z.infer<typeof vehicleSimulateInput>;

// ---- Config inputs ----

export const configSetInput: z.ZodType<{
  key: CoreConfigKey;
  value: string;
}> = z.object({
  key: z.enum(
    CORE_CONFIG_KEYS as readonly [CoreConfigKey, ...CoreConfigKey[]],
  ),
  value: z.string(),
});
export type ConfigSetInput = z.infer<typeof configSetInput>;

export const geocodeInput: z.ZodType<{
  q: string;
}> = z.object({
  q: z.string().min(1),
});
export type GeocodeInput = z.infer<typeof geocodeInput>;

export const geocodeAutocompleteInput: z.ZodType<{
  q: string;
}> = z.object({
  q: z.string().min(3),
});
export type GeocodeAutocompleteInput = z.infer<
  typeof geocodeAutocompleteInput
>;

// ---- Tariff inputs ----

export const tariffCreateInput: z.ZodType<{
  label: string;
  startTime: string;
  endTime: string;
  days: [DayOfWeekZ, ...DayOfWeekZ[]];
  ratePerKwh: number;
  enabled?: boolean | undefined;
}> = z.object({
  label: z.string().min(1),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  days: z.array(dayOfWeekSchema).nonempty(),
  ratePerKwh: z.number().min(0),
  enabled: z.boolean().optional(),
});
export type TariffCreateInput = z.infer<typeof tariffCreateInput>;

export const tariffUpdateInput: z.ZodType<{
  id: number;
  label?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  days?: [DayOfWeekZ, ...DayOfWeekZ[]] | undefined;
  ratePerKwh?: number | undefined;
  enabled?: boolean | undefined;
}> = z.object({
  id: z.number(),
  label: z.string().min(1).optional(),
  startTime: timeStringSchema.optional(),
  endTime: timeStringSchema.optional(),
  days: z.array(dayOfWeekSchema).nonempty().optional(),
  ratePerKwh: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
});
export type TariffUpdateInput = z.infer<typeof tariffUpdateInput>;

export const tariffDeleteInput: z.ZodType<{
  id: number;
}> = z.object({
  id: z.number(),
});
export type TariffDeleteInput = z.infer<typeof tariffDeleteInput>;

export const defaultRateUpdateInput: z.ZodType<{
  ratePerKwh: number;
  currencySymbol?: string | undefined;
  currencyCode?: string | undefined;
}> = z.object({
  ratePerKwh: z.number().min(0),
  currencySymbol: z.string().optional(),
  currencyCode: z.string().optional(),
});
export type DefaultRateUpdateInput = z.infer<typeof defaultRateUpdateInput>;

export const tariffPresetInput: z.ZodType<{
  template: string;
}> = z.object({
  template: z.string(),
});
export type TariffPresetInput = z.infer<typeof tariffPresetInput>;

// ---- Schedule inputs ----

export const scheduleCreateInput: z.ZodType<{
  scheduleType: ScheduleTypeZ;
  startTime: string;
  endTime: string;
  days: [DayOfWeekZ, ...DayOfWeekZ[]];
  vehicleId?: string | null | undefined;
  chargeAmps?: number | undefined;
  chargeLimitPct?: number | undefined;
}> = z.object({
  scheduleType: scheduleTypeSchema,
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  days: z.array(dayOfWeekSchema).nonempty(),
  vehicleId: z.string().nullable().optional(),
  chargeAmps: z.number().min(1).optional(),
  chargeLimitPct: z.number().min(1).max(100).optional(),
});
export type ScheduleCreateInput = z.infer<typeof scheduleCreateInput>;

export const scheduleUpdateInput: z.ZodType<{
  id: string;
  scheduleType?: ScheduleTypeZ | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  days?: [DayOfWeekZ, ...DayOfWeekZ[]] | undefined;
  vehicleId?: string | null | undefined;
  chargeAmps?: number | undefined;
  chargeLimitPct?: number | undefined;
  enabled?: boolean | undefined;
}> = z.object({
  id: z.string(),
  scheduleType: scheduleTypeSchema.optional(),
  startTime: timeStringSchema.optional(),
  endTime: timeStringSchema.optional(),
  days: z.array(dayOfWeekSchema).nonempty().optional(),
  vehicleId: z.string().nullable().optional(),
  chargeAmps: z.number().min(1).optional(),
  chargeLimitPct: z.number().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateInput>;

export const scheduleDeleteInput: z.ZodType<{
  id: string;
}> = z.object({
  id: z.string(),
});
export type ScheduleDeleteInput = z.infer<typeof scheduleDeleteInput>;

// ---- Wizard inputs ----

export const wizardDemoSetupInput: z.ZodType<{
  adapterType: string;
  timezone?: string | undefined;
}> = z.object({
  adapterType: z.string().min(1),
  timezone: z.string().optional(),
});
export type WizardDemoSetupInput = z.infer<typeof wizardDemoSetupInput>;

export const wizardSetAuthModeInput: z.ZodType<{
  mode: "none" | "local" | "oidc";
  localConfig?: { username: string; password: string } | undefined;
  oidcConfig?: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    baseUrl: string;
  } | undefined;
}> = z.object({
  mode: z.enum(["none", "local", "oidc"]),
  localConfig: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }).optional(),
  oidcConfig: z.object({
    issuerUrl: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    baseUrl: z.string().min(1),
  }).optional(),
});
export type WizardSetAuthModeInput = z.infer<typeof wizardSetAuthModeInput>;

export const wizardTestOidcDiscoveryInput: z.ZodType<{
  issuerUrl: string;
}> = z.object({
  issuerUrl: z.string().min(1),
});
export type WizardTestOidcDiscoveryInput = z.infer<
  typeof wizardTestOidcDiscoveryInput
>;

export const wizardImportKeysInput: z.ZodType<{
  publicKeyPem: string;
  privateKeyPem: string;
}> = z.object({
  publicKeyPem: z.string().includes("-----BEGIN PUBLIC KEY-----"),
  privateKeyPem: z.string(),
});
export type WizardImportKeysInput = z.infer<typeof wizardImportKeysInput>;

export const wizardSaveOidcConfigInput: z.ZodType<{
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}> = z.object({
  issuerUrl: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  baseUrl: z.string().min(1),
});
export type WizardSaveOidcConfigInput = z.infer<
  typeof wizardSaveOidcConfigInput
>;

export const wizardSetStepInput: z.ZodType<{ stepId: string }> = z.object({
  stepId: z.string(),
});

export const wizardSetVehicleTypeInput: z.ZodType<{ type: string }> = z.object({
  type: z.string(),
});

export const wizardSetEnergyTypeInput: z.ZodType<{ type: string }> = z.object({
  type: z.string(),
});

// ---- Auth inputs ----

export const updateOidcConfigInput: z.ZodType<{
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}> = z.object({
  issuerUrl: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  baseUrl: z.string().min(1),
});
export type UpdateOidcConfigInput = z.infer<typeof updateOidcConfigInput>;

export const authAuthorizeInput: z.ZodType<{
  origin: string;
}> = z.object({
  origin: z.string().min(1),
});
export type AuthAuthorizeInput = z.infer<typeof authAuthorizeInput>;

export const authSelectVehicleInput: z.ZodType<{
  vin: string;
  name?: string | undefined;
}> = z.object({
  vin: z.string(),
  name: z.string().optional(),
});
export type AuthSelectVehicleInput = z.infer<typeof authSelectVehicleInput>;

// ---- Logs inputs ----

export const logsPaginationInput: z.ZodObject<{
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
  from: z.ZodOptional<z.ZodString>;
  to: z.ZodOptional<z.ZodString>;
}> = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type LogsPaginationInput = z.infer<typeof logsPaginationInput>;

export const chargeControllerLogsInput: z.ZodType<{
  limit?: number | undefined;
  offset?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  vehicleId?: string | undefined;
  action?: string[] | undefined;
}> = logsPaginationInput.extend({
  vehicleId: z.string().optional(),
  action: z.array(z.string()).optional(),
});
export type ChargeControllerLogsInput = z.infer<
  typeof chargeControllerLogsInput
>;

export const vehicleUpdatesLogsInput: z.ZodType<{
  limit?: number | undefined;
  offset?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  vehicleId?: string | undefined;
}> = logsPaginationInput.extend({
  vehicleId: z.string().optional(),
});
export type VehicleUpdatesLogsInput = z.infer<typeof vehicleUpdatesLogsInput>;

export const pluginLogsInput: z.ZodType<{
  limit?: number | undefined;
  offset?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  pluginId?: string | undefined;
  level?: string[] | undefined;
  origin?: string | undefined;
  search?: string | undefined;
}> = logsPaginationInput.extend({
  pluginId: z.string().optional(),
  level: z.array(z.string()).optional(),
  origin: z.string().optional(),
  search: z.string().optional(),
});
export type PluginLogsInput = z.infer<typeof pluginLogsInput>;
