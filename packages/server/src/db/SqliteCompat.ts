/**
 * Compatibility wrapper that adapts @db/sqlite's API to the interface
 * expected by drizzle-orm/better-sqlite3.
 *
 * better-sqlite3 expects: stmt.all(), stmt.get(), stmt.run(), stmt.raw().all()
 * @db/sqlite provides: stmt.all(), stmt.get(), stmt.run(), stmt.values()
 *
 * The key difference is stmt.raw() — better-sqlite3 returns a chainable
 * "raw mode" Statement that returns tuples. We translate .raw().all() and
 * .raw().get() to @db/sqlite's .values() equivalent.
 */
import {
  Database as NativeDatabase,
  type RestBindParameters,
  type Statement,
} from "@db/sqlite";
import type {
  DatabaseDriver,
  DatabaseRawStatement,
  DatabaseStatement,
} from "@chargeha/shared/database-driver";

/** Wraps @db/sqlite PreparedQuery to add `.raw()` for better-sqlite3 compat. */
class CompatStatement implements DatabaseStatement {
  private stmt: Statement;

  constructor(stmt: Statement) {
    this.stmt = stmt;
  }

  all(...params: RestBindParameters): Record<string, unknown>[] {
    return this.stmt.all(...params);
  }

  get(...params: RestBindParameters): Record<string, unknown> | undefined {
    return this.stmt.get(...params);
  }

  run(
    ...params: RestBindParameters
  ): { changes: number; lastInsertRowid: number } {
    const changes = this.stmt.run(...params);
    return { changes, lastInsertRowid: this.stmt.db.lastInsertRowId };
  }

  /** Returns a "raw mode" view that returns tuples instead of objects. */
  raw(): DatabaseRawStatement {
    return new CompatRawStatement(this.stmt);
  }
}

class CompatRawStatement implements DatabaseRawStatement {
  private stmt: Statement;

  constructor(stmt: Statement) {
    this.stmt = stmt;
  }

  all(...params: RestBindParameters): unknown[][] {
    return this.stmt.values(...params);
  }

  get(...params: RestBindParameters): unknown[] | undefined {
    const rows = this.stmt.values(...params);
    return rows.length > 0 ? rows[0] : undefined;
  }
}

/**
 * Wraps @db/sqlite Database with the better-sqlite3 API surface that
 * drizzle-orm's better-sqlite3 driver requires.
 */
export class CompatDatabase implements DatabaseDriver {
  private native: NativeDatabase;

  constructor(path: string) {
    this.native = new NativeDatabase(path);
  }

  prepare(sql: string): DatabaseStatement {
    return new CompatStatement(this.native.prepare(sql));
  }

  exec(sql: string): void {
    this.native.exec(sql);
  }

  close(): void {
    this.native.close();
  }

  /**
   * better-sqlite3's transaction() returns an object with deferred/immediate/exclusive
   * methods. Drizzle calls `nativeTx[behavior](tx)` where behavior defaults to "deferred".
   */
  transaction<T, R>(
    fn: (tx: T) => R,
  ): {
    deferred: (tx: T) => R;
    immediate: (tx: T) => R;
    exclusive: (tx: T) => R;
  } {
    const db = this.native;
    const wrapTransaction = (begin: string) => (tx: T): R => {
      db.exec(begin);
      try {
        const result = fn(tx);
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    };
    return {
      deferred: wrapTransaction("BEGIN DEFERRED"),
      immediate: wrapTransaction("BEGIN IMMEDIATE"),
      exclusive: wrapTransaction("BEGIN EXCLUSIVE"),
    };
  }
}
