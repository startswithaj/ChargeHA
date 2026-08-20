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

// stations/simple-query paging response — defensive: the exact envelope is
// unconfirmed, so records/list/bare-array and several name keys are accepted.
export const semsPlusStationEntrySchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  plantId: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
  plantName: z.string().nullish(),
  stationName: z.string().nullish(),
}).passthrough();

export const semsPlusStationPageSchema = z.union([
  z.array(semsPlusStationEntrySchema),
  z.object({ records: z.array(semsPlusStationEntrySchema) }),
  z.object({ list: z.array(semsPlusStationEntrySchema) }),
]);

export function stationEntries(
  data: z.infer<typeof semsPlusStationPageSchema>,
): z.infer<typeof semsPlusStationEntrySchema>[] {
  if (Array.isArray(data)) return data;
  if ("records" in data) return data.records;
  return data.list;
}

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
  return stationEntries(parsed.data).flatMap((entry) => {
    const id = entry.id ?? entry.plantId;
    if (id === null || id === undefined) return [];
    const name = entry.name ?? entry.plantName ?? entry.stationName;
    return [{ id: String(id), name: name || String(id) }];
  });
}

export const loginEnvelopeSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  api: z.string().optional(),
  data: z.object({ token: z.string().optional(), api: z.string().optional() })
    .passthrough().optional(),
}).passthrough();
