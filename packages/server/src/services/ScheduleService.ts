import { ServiceError } from "../lib/ServiceError.ts";
import type { DayOfWeek } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ScheduleRow } from "../db/types.ts";
import type { Logger } from "../lib/Logger.ts";
import { isOneOffExpired, isScheduleActiveNow } from "@chargeha/shared/engine";
import { dayOfWeekForDate } from "@chargeha/shared/localTime";
import { resolveOneOffWindow } from "@chargeha/shared/oneOffCharge";

function rowToSchedule(
  row: {
    id: string;
    vehicleId: string | null;
    scheduleType: string;
    startTime: string;
    endTime: string;
    days: string[];
    chargeAmps: number | null;
    chargeLimitPct: number | null;
    oneOffDate?: string | null;
    enabled: boolean;
  },
) {
  if (row.scheduleType === "charge") {
    return {
      id: row.id,
      vehicleId: row.vehicleId as string,
      scheduleType: row.scheduleType as "charge",
      startTime: row.startTime,
      endTime: row.endTime,
      days: row.days as DayOfWeek[],
      chargeAmps: row.chargeAmps as number,
      chargeLimitPct: row.chargeLimitPct as number,
      oneOffDate: row.oneOffDate ?? null,
      enabled: row.enabled,
    };
  }
  return {
    id: row.id,
    vehicleId: null,
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

  /**
   * Schedule a one-off charge on the next occurrence of `startTime`.
   *
   * Stored as a normal charge schedule carrying a calendar date, so the
   * controller, wake logic and notifications treat it like any other charge
   * window. A vehicle holds at most one pending one-off — creating another
   * replaces it.
   */
  async createOneOff(input: {
    vehicleId: string;
    startTime: string;
    durationMinutes: number;
    chargeAmps: number;
    chargeLimitPct: number;
  }) {
    const vehicle = await this.db.getVehicle(input.vehicleId);
    if (!vehicle) {
      throw new ServiceError("Vehicle not found", "NOT_FOUND");
    }

    const timezone = await this.getTimezone();
    const window = resolveOneOffWindow(
      input.startTime,
      input.durationMinutes,
      new Date(),
      timezone,
    );

    // Replace any pending one-off for this vehicle
    const existing = await this.db.getSchedules();
    await Promise.all(
      existing
        .filter((s) =>
          s.scheduleType === "charge" && s.vehicleId === input.vehicleId &&
          !!s.oneOffDate
        )
        .map((s) => this.db.deleteSchedule(s.id)),
    );

    const id = crypto.randomUUID();
    await this.db.createSchedule({
      id,
      vehicleId: input.vehicleId,
      scheduleType: "charge",
      startTime: input.startTime,
      endTime: window.endTime,
      // Day-of-week isn't consulted for one-offs, but the column is NOT NULL
      // and keeps the row readable alongside recurring schedules.
      days: [dayOfWeekForDate(window.oneOffDate)],
      chargeAmps: input.chargeAmps,
      chargeLimitPct: input.chargeLimitPct,
      oneOffDate: window.oneOffDate,
    });

    const row = await this.db.getSchedule(id);
    if (!row) {
      throw new ServiceError(
        "Failed to create one-off charge",
        "INTERNAL_SERVER_ERROR",
      );
    }

    this.logger.info(
      `One-off charge created for ${vehicle.name}: ${window.oneOffDate} ${input.startTime}-${window.endTime} at ${input.chargeAmps}A to ${input.chargeLimitPct}% (${id})`,
    );
    return { schedule: rowToSchedule(row) };
  }

  /**
   * Delete one-off charges whose window has fully elapsed, returning the
   * schedules that survive.
   *
   * Called from the controller loop with the schedules it already loaded, so it
   * costs no extra read, and the caller can carry on with the returned list.
   */
  async deleteExpiredOneOffs(
    schedules: ScheduleRow[],
    now: Date,
    timezone: string,
  ): Promise<ScheduleRow[]> {
    const expired = schedules.filter((s) => isOneOffExpired(s, now, timezone));
    if (expired.length === 0) return schedules;

    await Promise.all(expired.map((s) => this.db.deleteSchedule(s.id)));
    this.logger.info(
      `Removed ${expired.length} expired one-off charge${
        expired.length === 1 ? "" : "s"
      }`,
    );
    return schedules.filter((s) => !expired.includes(s));
  }

  async create(input: {
    scheduleType: "charge" | "blockout";
    vehicleId?: string | null;
    startTime: string;
    endTime: string;
    days: DayOfWeek[];
    chargeAmps?: number | null;
    chargeLimitPct?: number | null;
  }) {
    // Additional validation for charge schedules
    if (input.scheduleType === "charge") {
      if (!input.vehicleId) {
        throw new ServiceError(
          "vehicleId is required for charge schedules",
          "BAD_REQUEST",
        );
      }
      if (!input.chargeAmps || input.chargeAmps < 1) {
        throw new ServiceError(
          "chargeAmps must be a positive number",
          "BAD_REQUEST",
        );
      }
      if (
        !input.chargeLimitPct || input.chargeLimitPct < 1 ||
        input.chargeLimitPct > 100
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

    await this.db.updateSchedule(input.id, {
      vehicleId: input.vehicleId,
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
