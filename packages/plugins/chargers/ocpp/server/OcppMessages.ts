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
}).passthrough();

export const sampledValue = z.object({
  value: z.string(),
  measurand: z.string().optional(), // absent = Energy.Active.Import.Register
  unit: z.string().optional(),
  phase: z.string().optional(),
}).passthrough();

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

/** Three-tier charging profile payloads (HA-integration pattern). */
export function chargingProfilePayload(
  purpose: "ChargePointMaxProfile" | "TxProfile" | "TxDefaultProfile",
  amps: number,
  transactionId?: number,
) {
  return {
    connectorId: purpose === "ChargePointMaxProfile" ? 0 : 1,
    csChargingProfiles: {
      chargingProfileId: purposeIds[purpose],
      stackLevel: 0,
      chargingProfilePurpose: purpose,
      chargingProfileKind: "Absolute",
      ...(transactionId !== undefined && { transactionId }),
      chargingSchedule: {
        chargingRateUnit: "A",
        chargingSchedulePeriod: [{ startPeriod: 0, limit: amps }],
      },
    },
  };
}

const purposeIds = {
  ChargePointMaxProfile: 1,
  TxDefaultProfile: 2,
  TxProfile: 3,
} as const;
