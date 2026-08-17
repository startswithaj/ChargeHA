// The live-state shapes, in a module that imports no other OCPP module. Kept
// apart from OcppCentralSystem so the pieces it is built from — the
// connection, the meter value parser — can name these types without importing
// their own consumer back.
import type { ChargePointStatus } from "./OcppMessages.ts";

export interface OcppChargerInfo {
  vendor: string;
  model: string;
  firmwareVersion: string;
}

export interface OcppLiveData {
  connected: boolean;
  status: ChargePointStatus | null;
  errorCode: string | null;
  statusInfo: string | null;
  vendorErrorCode: string | null;
  info: OcppChargerInfo | null;
  transactionId: number | null;
  // Wh register at StartTransaction — session energy baseline.
  meterStartWh: number | null;
  // Latest measurand readings (nulls = charger never sent them).
  powerW: number | null;
  currentA: number | null;
  // Null when the charger reported one unphased current, so the adapter
  // scales by phase count instead.
  currentSumA: number | null;
  voltageV: number | null;
  energyRegisterWh: number | null;
  lastMeterValuesAt: number | null;
  lastUpdated: string;
}

export const freshData = (): OcppLiveData => ({
  connected: false,
  status: null,
  errorCode: null,
  statusInfo: null,
  vendorErrorCode: null,
  info: null,
  transactionId: null,
  meterStartWh: null,
  powerW: null,
  currentA: null,
  currentSumA: null,
  voltageV: null,
  energyRegisterWh: null,
  lastMeterValuesAt: null,
  lastUpdated: new Date().toISOString(),
});
