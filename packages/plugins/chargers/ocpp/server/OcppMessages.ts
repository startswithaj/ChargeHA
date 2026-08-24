import { z } from "zod";

// Minimal Zod schemas for the fields we consume — unknown fields pass
// through (.passthrough()) since chargers send vendor extras.

export const chargePointStatus = z.enum([
  "Available",
  "Preparing",
  "Charging",
  "SuspendedEVSE",
  "SuspendedEV",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
]);
export type ChargePointStatus = z.infer<typeof chargePointStatus>;

export const bootNotificationReq = z.object({
  chargePointVendor: z.string(),
  chargePointModel: z.string(),
  firmwareVersion: z.string().optional(),
}).passthrough();

export const statusNotificationReq = z.object({
  connectorId: z.number(),
  errorCode: z.string(),
  status: chargePointStatus,
  info: z.string().optional(),
  vendorErrorCode: z.string().optional(),
}).passthrough();

export const sampledValue = z.object({
  value: z.string(),
  measurand: z.string().optional(), // absent = Energy.Active.Import.Register
  unit: z.string().optional(),
  phase: z.string().optional(),
}).passthrough();
export type SampledValue = z.infer<typeof sampledValue>;

export const meterValuesReq = z.object({
  connectorId: z.number(),
  transactionId: z.number().optional(),
  meterValue: z.array(z.object({
    timestamp: z.string(),
    sampledValue: z.array(sampledValue),
  })),
}).passthrough();

export const startTransactionReq = z.object({
  connectorId: z.number(),
  idTag: z.string(),
  meterStart: z.number(), // Wh
  timestamp: z.string(),
}).passthrough();

export const stopTransactionReq = z.object({
  transactionId: z.number(),
  meterStop: z.number(), // Wh
  timestamp: z.string(),
}).passthrough();

export const authorizeReq = z.object({ idTag: z.string() }).passthrough();

export const remoteResponse = z.object({
  status: z.enum(["Accepted", "Rejected"]),
}).passthrough();

// GetConfiguration.conf. `configurationKey` holds what the charger has;
// `unknownKey` lists what it does not. Both are optional in practice —
// chargers omit an empty array rather than sending one.
export const getConfigurationRes = z.object({
  configurationKey: z.array(
    z.object({
      key: z.string(),
      readonly: z.boolean().optional(),
      value: z.string().optional(),
    }).passthrough(),
  ).optional(),
  unknownKey: z.array(z.string()).optional(),
}).passthrough();

// ChangeConfiguration.conf. `status` is deliberately a bare string rather
// than the spec's enum: an unrecognised vendor status must map to "rejected"
// (a real outcome we handle), not throw and be recorded as a failed round trip.
export const changeConfigurationRes = z.object({
  status: z.string(),
}).passthrough();

export type ChargingProfilePurpose =
  | "ChargePointMaxProfile"
  | "TxProfile"
  | "TxDefaultProfile";

export interface ChargingProfileRequest {
  purpose: ChargingProfilePurpose;
  payload: Record<string, unknown>;
}

// Three-tier charging profile payloads (HA-integration pattern).
export function chargingProfilePayload(
  purpose: ChargingProfilePurpose,
  amps: number,
  transactionId?: number,
): ChargingProfileRequest {
  const isMax = purpose === "ChargePointMaxProfile";
  return {
    purpose,
    payload: {
      connectorId: isMax ? 0 : 1,
      csChargingProfiles: {
        chargingProfileId: purposeIds[purpose],
        stackLevel: 0,
        chargingProfilePurpose: purpose,
        // Absolute needs a startSchedule anchor; Relative anchors to the
        // transaction and is the spec-correct kind for the Tx tiers.
        chargingProfileKind: isMax ? "Absolute" : "Relative",
        ...(transactionId !== undefined && { transactionId }),
        chargingSchedule: {
          chargingRateUnit: "A",
          chargingSchedulePeriod: [{ startPeriod: 0, limit: amps }],
          ...(isMax && { startSchedule: new Date().toISOString() }),
        },
      },
    },
  };
}

// RemoteStartTransaction.req.chargingProfile — must be TxProfile purpose.
// Embedding the limit here removes the SetChargingProfile-before-start
// ordering problem entirely.
export function remoteStartTxProfile(amps: number): Record<string, unknown> {
  return {
    chargingProfileId: purposeIds.TxProfile,
    stackLevel: 0,
    chargingProfilePurpose: "TxProfile",
    chargingProfileKind: "Relative",
    chargingSchedule: {
      chargingRateUnit: "A",
      chargingSchedulePeriod: [{ startPeriod: 0, limit: amps }],
    },
  };
}

const purposeIds = {
  ChargePointMaxProfile: 1,
  TxDefaultProfile: 2,
  TxProfile: 3,
} as const;
