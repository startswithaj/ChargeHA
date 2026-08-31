import { z } from "zod";

export interface SemsToken {
  readonly api: string;
  readonly region?: string;
  readonly [key: string]: unknown;
}

export interface SemsStationSummary {
  id: string;
  name: string;
}

export interface SemsStationDetail {
  hasPowerflow: boolean;
  powerflow: SemsPowerflow | null;
  stationName: string | null;
  inverterModel: string | null;
  sourceUpdatedAtMs: number | null;
}

export interface GoodweSemsStationReader {
  clearSession(): void;
  getStationDetail(stationId: string): Promise<SemsStationDetail>;
  probeGatewayFlow?(
    stationId: string,
    legacy: SemsPowerflow | null,
  ): Promise<void>;
}

const numericish = z.union([z.string(), z.number()]).optional();

export const semsPowerflowSchema = z.object({
  pv: numericish,
  load: numericish,
  grid: numericish,
  bettery: numericish,
  betteryStatus: numericish,
  soc: numericish,
  gridStatus: numericish,
  loadStatus: numericish,
}).passthrough();

export type SemsPowerflow = z.infer<typeof semsPowerflowSchema>;

const semsEnvelopeSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  api: z.string().optional(),
  data: z.unknown(),
}).passthrough();

export const loginEnvelopeSchema = semsEnvelopeSchema.extend({
  data: z.object({ token: z.string().optional(), api: z.string().optional() })
    .passthrough().optional(),
});

export const stationListSchema = z.array(
  z.object({
    id: z.string().optional(),
    powerstation_id: z.string().optional(),
    stationname: z.string().optional(),
  }).passthrough(),
);

export const stationDetailSchema = z.object({
  hasPowerflow: z.boolean().optional(),
  powerflow: semsPowerflowSchema.nullish(),
  soc: z.object({ power: numericish }).passthrough().optional(),
  info: z.object({ stationname: z.string().optional() }).passthrough()
    .optional(),
  inverter: z.array(
    z.object({
      invert_full: z.object({
        model_type: z.string().optional(),
        last_time: z.number().optional(),
      })
        .passthrough().optional(),
    }).passthrough(),
  ).optional(),
}).passthrough();

export function toStationDetail(
  data: z.infer<typeof stationDetailSchema>,
): SemsStationDetail {
  const powerflow = data.hasPowerflow === true ? data.powerflow ?? null : null;
  if (
    powerflow && powerflow.soc === undefined && data.soc?.power !== undefined
  ) {
    powerflow.soc = data.soc.power;
  }
  const uploadTimes = (data.inverter ?? [])
    .map((entry) => entry.invert_full?.last_time)
    .filter((time): time is number => Number.isFinite(time));
  return {
    hasPowerflow: data.hasPowerflow === true,
    powerflow,
    stationName: data.info?.stationname ?? null,
    inverterModel: data.inverter?.[0]?.invert_full?.model_type ?? null,
    sourceUpdatedAtMs: uploadTimes.length ? Math.max(...uploadTimes) : null,
  };
}
