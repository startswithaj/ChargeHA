import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { chargers } from "../Schema.ts";
import type { ChargerRow, UpsertChargerInput } from "../types.ts";
import type { ChargingPointMode } from "@chargeha/shared";

export class ChargerRepository {
  constructor(private db: BetterSQLite3Database) {}

  async getChargers(): Promise<ChargerRow[]> {
    return await this.db.select().from(chargers)
      .orderBy(asc(chargers.priority)) as ChargerRow[];
  }

  async getCharger(id: string): Promise<ChargerRow | null> {
    const rows = await this.db.select().from(chargers)
      .where(eq(chargers.id, id)) as ChargerRow[];
    return rows[0] ?? null;
  }

  async upsertCharger(input: UpsertChargerInput): Promise<void> {
    await this.db.insert(chargers)
      .values({ ...input })
      .onConflictDoUpdate({
        target: chargers.id,
        set: { ...input, updatedAt: new Date().toISOString() },
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
