import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { chargers } from "../Schema.ts";
import type { ChargerRow, UpsertChargerInput } from "../types.ts";
import type { ChargerKind, ChargingPointMode } from "@chargeha/shared";

type ChargerRecord = typeof chargers.$inferSelect;

function toChargerRow(row: ChargerRecord): ChargerRow {
  return {
    ...row,
    mode: row.mode as ChargingPointMode,
    kind: row.kind as ChargerKind,
    active: row.active === 1,
  };
}

function toColumns(input: UpsertChargerInput) {
  const { active, ...rest } = input;
  return active === undefined ? rest : { ...rest, active: active ? 1 : 0 };
}

export class ChargerRepository {
  constructor(private db: BetterSQLite3Database) {}

  async getChargers(): Promise<ChargerRow[]> {
    const rows = await this.db.select().from(chargers)
      .orderBy(asc(chargers.priority));
    return rows.map(toChargerRow);
  }

  async getCharger(id: string): Promise<ChargerRow | null> {
    const rows = await this.db.select().from(chargers)
      .where(eq(chargers.id, id));
    const row = rows[0];
    return row ? toChargerRow(row) : null;
  }

  async upsertCharger(input: UpsertChargerInput): Promise<void> {
    const values = toColumns(input);
    await this.db.insert(chargers)
      .values(values)
      .onConflictDoUpdate({
        target: chargers.id,
        set: { ...values, updatedAt: new Date().toISOString() },
      });
  }

  async updateChargerMode(id: string, mode: ChargingPointMode): Promise<void> {
    await this.db.update(chargers)
      .set({ mode, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async updateChargerPriority(id: string, priority: number): Promise<void> {
    await this.db.update(chargers)
      .set({ priority, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async updateChargerActive(id: string, active: boolean): Promise<void> {
    await this.db.update(chargers)
      .set({ active: active ? 1 : 0, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async deleteCharger(id: string): Promise<void> {
    await this.db.delete(chargers).where(eq(chargers.id, id));
  }

  async resequencePriorities(): Promise<void> {
    const rows = await this.getChargers();
    await rows.reduce(
      (chain, row, i) =>
        chain.then(() => this.updateChargerPriority(row.id, i + 1)),
      Promise.resolve(),
    );
  }
}
