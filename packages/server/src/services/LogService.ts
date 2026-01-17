import type { AppDatabase } from "../db/AppDatabase.ts";
import {
  parseDecisionChecks,
  parseDecisionInputs,
} from "../db/Serialization.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Parse JSON, falling back to the raw string on failure (corrupted DB data). */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Clamp pagination limit to [1, MAX_LIMIT], defaulting to DEFAULT_LIMIT. */
function clampLimit(limit?: number): number {
  return Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
}

export class LogService {
  constructor(private readonly db: AppDatabase) {}

  /** Fetch paginated controller logs with parsed JSON fields. */
  async getControllerLogs(input: {
    limit?: number;
    offset?: number;
    vehicleId?: string;
    from?: string;
    to?: string;
    action?: string[];
  }) {
    const limit = clampLimit(input.limit);
    const offset = input.offset ?? 0;

    const { rows, total } = await this.db.logs.getControllerLogs({
      limit,
      offset,
      vehicleId: input.vehicleId,
      from: input.from,
      to: input.to,
      actions: input.action,
    });

    const logs = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      vehicleId: row.vehicleId,
      vehicleName: row.vehicleName,
      mode: row.mode,
      inputs: parseDecisionInputs(row.inputsJson),
      checks: parseDecisionChecks(row.checksJson),
      action: row.action,
      actionDetail: row.actionDetail,
      targetAmps: row.targetAmps,
      traceId: row.traceId,
    }));

    return { logs, total };
  }

  /** Fetch paginated energy readings. */
  async getEnergyReadings(input: {
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
  }) {
    const limit = clampLimit(input.limit);
    const offset = input.offset ?? 0;

    const { rows, total } = await this.db.energy.getEnergyReadingsPaginated({
      limit,
      offset,
      from: input.from,
      to: input.to,
    });

    return { readings: rows, total };
  }

  /** Fetch paginated plugin logs with parsed JSON payloads. */
  async getPluginLogs(input: {
    limit?: number;
    offset?: number;
    pluginId?: string;
    from?: string;
    to?: string;
    level?: string[];
    origin?: string;
    search?: string;
  }) {
    const limit = clampLimit(input.limit);
    const offset = input.offset ?? 0;

    const { rows, total } = await this.db.logs.getPluginLogs({
      limit,
      offset,
      pluginId: input.pluginId,
      from: input.from,
      to: input.to,
      level: input.level,
      origin: input.origin,
      search: input.search,
    });

    const logs = rows.map((row) => ({
      ...row,
      payload: row.payload ? tryParseJson(row.payload) : null,
    }));

    return { logs, total };
  }

  /** Fetch paginated vehicle poll logs. */
  async getVehicleUpdates(input: {
    limit?: number;
    offset?: number;
    vehicleId?: string;
    from?: string;
    to?: string;
  }) {
    const limit = clampLimit(input.limit);
    const offset = input.offset ?? 0;

    const { rows, total } = await this.db.logs.getVehiclePollLogsPaginated({
      limit,
      offset,
      vehicleId: input.vehicleId,
      from: input.from,
      to: input.to,
    });

    return { readings: rows, total };
  }
}
