/// <reference lib="deno.ns" />
import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolve } from "node:path";
import type { DatabaseDriver } from "@chargeha/shared/database-driver";
import type { Logger } from "../lib/Logger.ts";

/** Path to the drizzle migrations folder, resolved from the working directory. */
const MIGRATIONS_FOLDER = resolve(Deno.cwd(), "drizzle");

/**
 * Run Drizzle migrations directly via @db/sqlite. Tracks applied migrations
 * by hash — no timestamp comparisons (@db/sqlite v0.12 truncates integers
 * > 2^31, which historically caused the journal to be re-populated on every
 * boot).
 */
export function runMigrations(sqlite: DatabaseDriver, logger: Logger): void {
  const migrations = readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  });

  sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  // Historic runner versions re-inserted the same hash on every boot; collapse
  // any duplicates so the applied-set below reflects reality.
  sqlite.exec(
    `DELETE FROM __drizzle_migrations WHERE id NOT IN (
      SELECT MIN(id) FROM __drizzle_migrations GROUP BY hash
    )`,
  );

  const rows = sqlite.prepare("SELECT hash FROM __drizzle_migrations")
    .all() as { hash: string }[];
  const applied = new Set(rows.map((r) => r.hash));

  const insert = sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );

  // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
  for (const migration of migrations) {
    if (applied.has(migration.hash)) continue;
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    for (const stmt of migration.sql) {
      sqlite.exec(stmt);
    }
    insert.run(migration.hash, String(migration.folderMillis));
    logger.info(`Applied migration ${migration.hash}`);
  }
}
