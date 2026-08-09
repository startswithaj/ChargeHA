import { ServiceError } from "../lib/ServiceError.ts";
import type { DayOfWeek } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import { isScheduleActiveNow } from "@chargeha/shared/engine";

function rowToSchedule(
  row: {
    id: string;
    vehicleId: string | null;
    chargerId: string | null;
    scheduleType: string;
    startTime: string;
    endTime: string;
    days: string[];
    chargeAmps: number | null;
    chargeLimitPct: number | null;
    enabled: boolean;
  },
) {
  if (row.scheduleType === "charge") {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      chargerId: row.chargerId,
      scheduleType: row.scheduleType as "charge",
      startTime: row.startTime,
      endTime: row.endTime,
      days: row.days as DayOfWeek[],
      chargeAmps: row.chargeAmps as number,
      chargeLimitPct: row.chargeLimitPct,
      enabled: row.enabled,
    };
  }
  return {
    id: row.id,
    vehicleId: null,
    chargerId: null,
    scheduleType: row.scheduleType as "blockout",
    startTime: row.startTime,
    endTime: row.endTime,
    days: row.days as DayOfWeek[],
    enabled: row.enabled,
  };
}

export class ScheduleService {
  constructor(
    private db: AppDatabase,
    private logger: Logger,
  ) {}

  async list() {
    const rows = await this.db.getSchedules();
    return { schedules: rows.map(rowToSchedule) };
  }

  /** Return schedules that are currently active based on the configured timezone. */
  async getActiveSchedules() {
    const timezone = await this.getTimezone();
    const rows = await this.db.getSchedules();
    const now = new Date();
    return rows
      .filter((s) => s.enabled && isScheduleActiveNow(s, now, timezone))
      .map(rowToSchedule);
  }

  /** Active charge schedule for a specific vehicle right now, or null.
   *  Blockouts are excluded — they're not vehicle charge targets. */
  async getActiveChargeForVehicle(vehicleId: string) {
    const active = await this.getActiveSchedules();
    const found = active.find(
      (s) => s.scheduleType === "charge" && s.vehicleId === vehicleId,
    );
    return found && found.scheduleType === "charge" ? found : null;
  }

  private async getTimezone(): Promise<string> {
    return (await this.db.getConfig("timezone")) ?? "UTC";
  }

  async create(input: {
    scheduleType: "charge" | "blockout";
    vehicleId?: string | null;
    chargerId?: string | null;
    startTime: string;
    endTime: string;
    days: DayOfWeek[];
    chargeAmps?: number | null;
    chargeLimitPct?: number | null;
  }) {
    if (input.scheduleType === "charge") {
      const targets = [input.vehicleId, input.chargerId]
        .filter((t) => t != null);
      if (targets.length !== 1) {
        throw new ServiceError(
          "charge schedules need exactly one target: vehicleId or chargerId",
          "BAD_REQUEST",
        );
      }
      if (!input.chargeAmps || input.chargeAmps < 1) {
        throw new ServiceError(
          "chargeAmps must be a positive number",
          "BAD_REQUEST",
        );
      }
      // A charger-keyed schedule can still stop at a target SOC: the engine
      // reads battery level from whichever vehicle resolves to the charger.
      if (input.vehicleId != null && input.chargeLimitPct == null) {
        throw new ServiceError(
          "chargeLimitPct must be between 1 and 100",
          "BAD_REQUEST",
        );
      }
      if (
        input.chargeLimitPct != null &&
        (input.chargeLimitPct < 1 || input.chargeLimitPct > 100)
      ) {
        throw new ServiceError(
          "chargeLimitPct must be between 1 and 100",
          "BAD_REQUEST",
        );
      }
    }

    const id = crypto.randomUUID();
    const isCharge = input.scheduleType === "charge";
    await this.db.createSchedule({
      id,
      vehicleId: isCharge ? (input.vehicleId ?? null) : null,
      chargerId: isCharge ? (input.chargerId ?? null) : null,
      scheduleType: input.scheduleType,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      chargeAmps: isCharge ? (input.chargeAmps ?? null) : null,
      chargeLimitPct: isCharge ? (input.chargeLimitPct ?? null) : null,
    });

    const row = await this.db.getSchedule(id);
    if (!row) {
      throw new ServiceError(
        "Failed to create schedule",
        "INTERNAL_SERVER_ERROR",
      );
    }

    this.logger.info(`Schedule created: ${input.scheduleType} (${id})`);
    return { schedule: rowToSchedule(row) };
  }

  async update(input: {
    id: string;
    vehicleId?: string | null;
    chargerId?: string | null;
    scheduleType?: "charge" | "blockout";
    startTime?: string;
    endTime?: string;
    days?: DayOfWeek[];
    chargeAmps?: number | null;
    chargeLimitPct?: number | null;
    enabled?: boolean;
  }) {
    const existing = await this.db.getSchedule(input.id);
    if (!existing) {
      throw new ServiceError("Schedule not found", "NOT_FOUND");
    }

    // The merged row must satisfy the same invariants as create.
    const merged = {
      vehicleId: input.vehicleId !== undefined
        ? input.vehicleId
        : existing.vehicleId,
      chargerId: input.chargerId !== undefined
        ? input.chargerId
        : existing.chargerId,
      scheduleType: input.scheduleType ?? existing.scheduleType,
      chargeLimitPct: input.chargeLimitPct !== undefined
        ? input.chargeLimitPct
        : existing.chargeLimitPct,
    };
    if (merged.scheduleType === "charge") {
      const targets = [merged.vehicleId, merged.chargerId]
        .filter((t) => t != null);
      if (targets.length !== 1) {
        throw new ServiceError(
          "charge schedules need exactly one target: vehicleId or chargerId",
          "BAD_REQUEST",
        );
      }
      if (merged.vehicleId == null && merged.chargeLimitPct != null) {
        throw new ServiceError(
          "chargeLimitPct only applies to vehicle-keyed schedules",
          "BAD_REQUEST",
        );
      }
    }

    await this.db.updateSchedule(input.id, {
      vehicleId: input.vehicleId,
      chargerId: input.chargerId,
      scheduleType: input.scheduleType,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      chargeAmps: input.chargeAmps,
      chargeLimitPct: input.chargeLimitPct,
      enabled: input.enabled,
    });

    const row = await this.db.getSchedule(input.id);
    if (!row) {
      throw new ServiceError(
        "Schedule not found after update",
        "INTERNAL_SERVER_ERROR",
      );
    }

    this.logger.info(`Schedule updated: ${row.scheduleType} (${input.id})`);
    return { schedule: rowToSchedule(row) };
  }

  async delete(id: string) {
    const existing = await this.db.getSchedule(id);
    if (!existing) {
      throw new ServiceError("Schedule not found", "NOT_FOUND");
    }

    await this.db.deleteSchedule(id);
    this.logger.info(`Schedule deleted: ${id}`);
    return { success: true };
  }
}
