import { z } from "zod";

// SEMS+ gateway flow payload. kW floats; pGrid signed (positive = export).
// Field names confirmed from the SEMS+ web app bundle: battery arrives as
// pBat + soc, EV charging as pEvChar.
export const semsPlusFlowSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  status: z.union([z.string(), z.number()]).optional(),
  pAc: z.number().nullish(),
  pSystem: z.number().nullish(),
  pGrid: z.number().nullish(),
  pConsum: z.number().nullish(),
  pBat: z.number().nullish(),
  soc: z.number().nullish(),
  pEvChar: z.number().nullish(),
  refreshTime: z.string().nullish(),
}).passthrough();

export type SemsPlusFlow = z.infer<typeof semsPlusFlowSchema>;

export interface SemsPlusStation {
  id: string;
  name: string;
}

export const semsPlusStationEntrySchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
  stationName: z.string().nullish(),
}).passthrough();

// simple-query pages like every list in the SEMS+ app: data.dataList with
// data.total, page keys current/size (index.2bdaccf7.js dataPath/totalPath).
export const semsPlusStationPageSchema = z.object({
  dataList: z.array(semsPlusStationEntrySchema).default([]),
  total: z.number().nullish(),
}).passthrough();

export function parseFlow(data: unknown): SemsPlusFlow {
  const parsed = semsPlusFlowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("SEMS+ flow payload arrived in an unrecognised shape");
  }
  // A parseable but empty flow is what the gateway returns for an unknown or
  // un-migrated station — all-zero readings must not pass as good data.
  if (parsed.data.pGrid == null && parsed.data.pConsum == null) {
    throw new Error(
      "SEMS+ returned no power flow data for this station — a GoodWe " +
        "HomeKit or smart meter is required for grid and consumption " +
        "readings, and the station must appear in the SEMS+ app",
    );
  }
  return parsed.data;
}

export function parseStations(data: unknown): SemsPlusStation[] | null {
  const parsed = semsPlusStationPageSchema.safeParse(data);
  if (!parsed.success) return null;
  return parsed.data.dataList.flatMap((entry) => {
    const id = entry.id;
    if (id === null || id === undefined) return [];
    const name = entry.name ?? entry.stationName;
    return [{ id: String(id), name: name || String(id) }];
  });
}

export const loginEnvelopeSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  api: z.string().optional(),
  data: z.object({ token: z.string().optional(), api: z.string().optional() })
    .passthrough().optional(),
}).passthrough();
