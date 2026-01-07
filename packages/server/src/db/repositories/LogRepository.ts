import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  max,
  not,
  or,
  sql,
} from "drizzle-orm";
import { controllerLogs, pluginLogs, vehiclePollLogs } from "../Schema.ts";
import { toSqliteDatetime } from "./sqliteHelpers.ts";
import type { ControllerAction, VehicleMode } from "@chargeha/shared";
import type {
  ControllerLogInput,
  ControllerLogRow,
  PluginLogInput,
  PluginLogRow,
  VehiclePollLogInput,
} from "../types.ts";

/** Split a plugin-log search string into an include phrase and exclude
 *  tokens. Tokens prefixed with `-` (e.g. `-online-check`) are excludes;
 *  everything else is joined back with spaces and used as a substring
 *  search. Bare `-` is ignored. Exported for tests. */
export function parsePluginLogSearch(
  input: string,
): { include: string; excludes: string[] } {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const excludes = tokens
    .filter((t) => t.startsWith("-") && t.length > 1)
    .map((t) => t.slice(1));
  const includes = tokens.filter((t) => !t.startsWith("-"));
  return { include: includes.join(" "), excludes };
}

export class LogRepository {
  constructor(private db: BetterSQLite3Database) {}

  // ---- Controller logs ----

  async insertControllerLogEntries(
    entries: ControllerLogInput[],
  ): Promise<void> {
    await entries.reduce(
      (chain, e) =>
        chain.then(() =>
          this.db.insert(controllerLogs).values({
            vehicleId: e.vehicleId,
            vehicleName: e.vehicleName,
            mode: e.mode,
            inputsJson: e.inputsJson,
            checksJson: e.checksJson,
            action: e.action,
            actionDetail: e.actionDetail,
            targetAmps: e.targetAmps,
            traceId: e.traceId,
          })
        ),
      Promise.resolve() as Promise<unknown>,
    );
  }

  async getControllerLogs(opts: {
    limit: number;
    offset: number;
    vehicleId?: string;
    from?: string;
    to?: string;
    actions?: string[];
    traceId?: string;
  }): Promise<{ rows: ControllerLogRow[]; total: number }> {
    const conditions = [];

    if (opts.vehicleId) {
      conditions.push(eq(controllerLogs.vehicleId, opts.vehicleId));
    }
    if (opts.from) {
      conditions.push(
        gte(controllerLogs.timestamp, toSqliteDatetime(opts.from)),
      );
    }
    if (opts.to) {
      conditions.push(
        lte(controllerLogs.timestamp, toSqliteDatetime(opts.to)),
      );
    }
    if (opts.actions && opts.actions.length > 0) {
      conditions.push(inArray(controllerLogs.action, opts.actions));
    }
    if (opts.traceId) {
      conditions.push(eq(controllerLogs.traceId, opts.traceId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db
      .select({ cnt: count() })
      .from(controllerLogs)
      .where(where);
    const total = countResult[0].cnt;

    const rows = (await this.db
      .select()
      .from(controllerLogs)
      .where(where)
      .orderBy(desc(controllerLogs.timestamp))
      .limit(opts.limit)
      .offset(opts.offset)) as ControllerLogRow[];

    return { rows, total };
  }

  async getRecentStateChanges(
    sinceMinutes: number,
    after?: string,
  ): Promise<
    Array<{
      vehicleId: string;
      vehicleName: string;
      action: ControllerAction;
      timestamp: string;
    }>
  > {
    const conditions = [
      inArray(controllerLogs.action, ["start", "stop"]),
      gte(
        controllerLogs.timestamp,
        sql`datetime('now', ${`-${sinceMinutes} minutes`})`,
      ),
    ];
    if (after) conditions.push(gt(controllerLogs.timestamp, after));

    const rows = await this.db
      .select({
        vehicleId: controllerLogs.vehicleId,
        vehicleName: controllerLogs.vehicleName,
        action: controllerLogs.action,
        timestamp: controllerLogs.timestamp,
      })
      .from(controllerLogs)
      .where(and(...conditions))
      .orderBy(asc(controllerLogs.vehicleId), asc(controllerLogs.timestamp));

    return rows.map((row) => ({
      ...row,
      action: row.action as ControllerAction,
    }));
  }

  /** Returns the most recent controller log entry for each vehicle. */
  async getLastControllerLogPerVehicle(): Promise<ControllerLogRow[]> {
    const latest = this.db
      .select({
        vehicleId: controllerLogs.vehicleId,
        maxId: max(controllerLogs.id).as("max_id"),
      })
      .from(controllerLogs)
      .groupBy(controllerLogs.vehicleId)
      .as("latest");

    const rows = await this.db
      .select({
        id: controllerLogs.id,
        timestamp: controllerLogs.timestamp,
        vehicleId: controllerLogs.vehicleId,
        vehicleName: controllerLogs.vehicleName,
        mode: controllerLogs.mode,
        inputsJson: controllerLogs.inputsJson,
        checksJson: controllerLogs.checksJson,
        action: controllerLogs.action,
        actionDetail: controllerLogs.actionDetail,
        targetAmps: controllerLogs.targetAmps,
        traceId: controllerLogs.traceId,
      })
      .from(controllerLogs)
      .innerJoin(latest, eq(controllerLogs.id, latest.maxId));

    return rows.map((row) => ({
      ...row,
      mode: row.mode as VehicleMode,
      action: row.action as ControllerAction,
      targetAmps: row.targetAmps ?? null,
      traceId: row.traceId ?? null,
    }));
  }

  async pruneControllerLogs(retentionDays: number): Promise<void> {
    await this.db
      .delete(controllerLogs)
      .where(
        lt(
          controllerLogs.timestamp,
          sql`datetime('now', ${`-${retentionDays} days`})`,
        ),
      );
  }

  // ---- Vehicle poll logs ----

  async insertVehiclePollLog(input: VehiclePollLogInput): Promise<void> {
    await this.db.insert(vehiclePollLogs).values({
      vehicleId: input.vehicleId,
      vehicleName: input.vehicleName,
      isOnline: input.isOnline ? 1 : 0,
      isPluggedIn: input.isPluggedIn ? 1 : 0,
      isCharging: input.isCharging ? 1 : 0,
      batteryLevel: input.batteryLevel,
      chargeLimit: input.chargeLimit,
      chargeAmps: input.chargeAmps,
      chargeAmpsMax: input.chargeAmpsMax,
      chargePowerKw: input.chargePowerKw,
      chargerVoltage: input.chargerVoltage,
      energyAddedKwh: input.energyAddedKwh,
      minutesToFull: input.minutesToFull,
      isHome: input.isHome ? 1 : 0,
    });
  }

  async getVehiclePollLogsPaginated(opts: {
    limit: number;
    offset: number;
    vehicleId?: string;
    from?: string;
    to?: string;
  }): Promise<{
    rows: Array<{
      id: number;
      timestamp: string;
      vehicleId: string;
      vehicleName: string;
      isOnline: boolean;
      isPluggedIn: boolean;
      isCharging: boolean;
      batteryLevel: number;
      chargeLimit: number;
      chargeAmps: number;
      chargeAmpsMax: number;
      chargePowerKw: number;
      chargerVoltage: number;
      energyAddedKwh: number;
      minutesToFull: number;
      isHome: boolean;
    }>;
    total: number;
  }> {
    const conditions = [];

    if (opts.vehicleId) {
      conditions.push(eq(vehiclePollLogs.vehicleId, opts.vehicleId));
    }
    if (opts.from) {
      conditions.push(
        gte(vehiclePollLogs.timestamp, toSqliteDatetime(opts.from)),
      );
    }
    if (opts.to) {
      conditions.push(
        lte(vehiclePollLogs.timestamp, toSqliteDatetime(opts.to)),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db
      .select({ cnt: count() })
      .from(vehiclePollLogs)
      .where(where);
    const total = countResult[0].cnt;

    const result = await this.db
      .select()
      .from(vehiclePollLogs)
      .where(where)
      .orderBy(desc(vehiclePollLogs.timestamp))
      .limit(opts.limit)
      .offset(opts.offset);

    const rows = result.map((row) => ({
      ...row,
      isOnline: row.isOnline === 1,
      isPluggedIn: row.isPluggedIn === 1,
      isCharging: row.isCharging === 1,
      isHome: row.isHome === 1,
    }));

    return { rows, total };
  }

  async pruneVehiclePollLogs(retentionDays: number): Promise<void> {
    await this.db
      .delete(vehiclePollLogs)
      .where(
        lt(
          vehiclePollLogs.timestamp,
          sql`datetime('now', ${`-${retentionDays} days`})`,
        ),
      );
  }

  // ---- Plugin logs ----

  async insertPluginLog(input: PluginLogInput): Promise<void> {
    await this.db.insert(pluginLogs).values({
      pluginId: input.pluginId,
      level: input.level,
      message: input.message,
      payload: input.payload ?? null,
      origin: input.origin ?? null,
      traceId: input.traceId ?? null,
    });
  }

  async getPluginLogs(opts: {
    limit: number;
    offset: number;
    pluginId?: string;
    from?: string;
    to?: string;
    level?: string[];
    origin?: string;
    traceId?: string;
    search?: string;
  }): Promise<{ rows: PluginLogRow[]; total: number }> {
    const conditions = [];

    if (opts.pluginId) {
      conditions.push(eq(pluginLogs.pluginId, opts.pluginId));
    }
    if (opts.from) {
      conditions.push(gte(pluginLogs.timestamp, toSqliteDatetime(opts.from)));
    }
    if (opts.to) {
      conditions.push(lte(pluginLogs.timestamp, toSqliteDatetime(opts.to)));
    }
    if (opts.level && opts.level.length > 0) {
      conditions.push(inArray(pluginLogs.level, opts.level));
    }
    if (opts.origin) {
      conditions.push(eq(pluginLogs.origin, opts.origin));
    }
    if (opts.traceId) {
      conditions.push(eq(pluginLogs.traceId, opts.traceId));
    }
    if (opts.search && opts.search.trim().length > 0) {
      // Tokens prefixed with `-` exclude rows that match in any column;
      // remaining tokens are joined back into a single substring search.
      // e.g. "tesla -online-check" → include phrase "tesla", exclude "online-check"
      const { include, excludes } = parsePluginLogSearch(opts.search);
      // SQLite LIKE is ASCII case-insensitive by default.
      if (include) {
        const pattern = `%${include}%`;
        conditions.push(
          or(
            like(pluginLogs.message, pattern),
            like(pluginLogs.origin, pattern),
            like(pluginLogs.pluginId, pattern),
            like(pluginLogs.payload, pattern),
          ),
        );
      }
      const excludeConditions = excludes.flatMap((term) => {
        const pattern = `%${term}%`;
        const matchAny = or(
          like(pluginLogs.message, pattern),
          like(pluginLogs.origin, pattern),
          like(pluginLogs.pluginId, pattern),
          like(pluginLogs.payload, pattern),
        );
        return matchAny ? [not(matchAny)] : [];
      });
      conditions.push(...excludeConditions);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db
      .select({ cnt: count() })
      .from(pluginLogs)
      .where(where);
    const total = countResult[0].cnt;

    const rows = (await this.db
      .select()
      .from(pluginLogs)
      .where(where)
      .orderBy(desc(pluginLogs.timestamp))
      .limit(opts.limit)
      .offset(opts.offset)) as PluginLogRow[];

    return { rows, total };
  }

  async prunePluginLogs(retentionDays: number): Promise<void> {
    await this.db
      .delete(pluginLogs)
      .where(
        lt(
          pluginLogs.timestamp,
          sql`datetime('now', ${`-${retentionDays} days`})`,
        ),
      );
  }
}
