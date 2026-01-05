import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { config as configTable } from "../Schema.ts";

export class ConfigRepository {
  constructor(private db: BetterSQLite3Database) {}

  async getConfig(key: string): Promise<string | null> {
    const result = await this.db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, key));
    if (result.length === 0) return null;
    return result[0].value;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.db
      .insert(configTable)
      .values({ key, value, isEncrypted: 0 })
      .onConflictDoUpdate({
        target: configTable.key,
        set: { value, isEncrypted: 0 },
      });
  }

  async setSecret(
    key: string,
    value: string,
    isEncrypted: boolean,
  ): Promise<void> {
    const encryptedInt = isEncrypted ? 1 : 0;
    await this.db
      .insert(configTable)
      .values({ key, value, isEncrypted: encryptedInt })
      .onConflictDoUpdate({
        target: configTable.key,
        set: { value, isEncrypted: encryptedInt },
      });
  }

  async getSecret(
    key: string,
  ): Promise<{ value: string; isEncrypted: boolean } | null> {
    const result = await this.db
      .select({
        value: configTable.value,
        isEncrypted: configTable.isEncrypted,
      })
      .from(configTable)
      .where(eq(configTable.key, key));
    if (result.length === 0) return null;
    return {
      value: result[0].value,
      isEncrypted: result[0].isEncrypted === 1,
    };
  }

  async hasEncryptedRows(): Promise<boolean> {
    const result = await this.db
      .select({ key: configTable.key })
      .from(configTable)
      .where(eq(configTable.isEncrypted, 1))
      .limit(1);
    return result.length > 0;
  }
}
