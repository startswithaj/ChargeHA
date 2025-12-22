/**
 * sql.js (WASM) implementation of DatabaseDriver for browser use.
 */
import type {
  DatabaseDriver,
  DatabaseRawStatement,
  DatabaseStatement,
} from "./database-driver.ts";

export interface SqlJsApi {
  Database: new () => SqlJsDatabase;
}

/** Type for the sql.js initialization function (e.g. `initSqlJs`). */
export type SqlJsInit = (config: {
  locateFile: (file: string) => string;
}) => Promise<SqlJsApi>;

interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  run(sql: string, params?: unknown[]): void;
  getRowsModified(): number;
  exec(sql: string): Array<{ values: unknown[][] }>;
  close(): void;
}

interface SqlJsStatement {
  bind(params: unknown[]): void;
  step(): boolean;
  getColumnNames(): string[];
  get(): unknown[];
  free(): void;
}

class WasmStatement implements DatabaseStatement {
  constructor(private db: SqlJsDatabase, private sql: string) {}

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(this.sql);
    if (params.length > 0) stmt.bind(params as unknown[]);
    const results: Record<string, unknown>[] = [];
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    while (stmt.step()) {
      const row: Record<string, unknown> = {};
      const cols = stmt.getColumnNames();
      const vals = stmt.get();
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = vals[i];
      }
      results.push(row);
    }
    stmt.free();
    return results;
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const rows = this.all(...params);
    return rows[0];
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(this.sql);
    if (params.length > 0) stmt.bind(params as unknown[]);
    stmt.step();
    stmt.free();
    const changes = this.db.getRowsModified();
    const lastRow = this.db.exec("SELECT last_insert_rowid()");
    const lastInsertRowid = lastRow[0]?.values[0]?.[0] as number ?? 0;
    return { changes, lastInsertRowid };
  }

  raw(): DatabaseRawStatement {
    return new WasmRawStatement(this.db, this.sql);
  }
}

class WasmRawStatement implements DatabaseRawStatement {
  constructor(private db: SqlJsDatabase, private sql: string) {}

  all(...params: unknown[]): unknown[][] {
    const stmt = this.db.prepare(this.sql);
    if (params.length > 0) stmt.bind(params as unknown[]);
    const results: unknown[][] = [];
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    while (stmt.step()) {
      results.push(stmt.get());
    }
    stmt.free();
    return results;
  }

  get(...params: unknown[]): unknown[] | undefined {
    const rows = this.all(...params);
    return rows[0];
  }
}

export class WasmDatabase implements DatabaseDriver {
  private db: SqlJsDatabase;

  constructor(db: SqlJsDatabase) {
    this.db = db;
  }

  prepare(sql: string): DatabaseStatement {
    return new WasmStatement(this.db, sql);
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  close(): void {
    this.db.close();
  }

  transaction<T, R>(
    fn: (tx: T) => R,
  ): {
    deferred: (tx: T) => R;
    immediate: (tx: T) => R;
    exclusive: (tx: T) => R;
  } {
    const db = this.db;
    const wrapTransaction = (begin: string) => (tx: T): R => {
      db.run(begin);
      try {
        const result = fn(tx);
        db.run("COMMIT");
        return result;
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    };
    return {
      deferred: wrapTransaction("BEGIN DEFERRED"),
      immediate: wrapTransaction("BEGIN IMMEDIATE"),
      exclusive: wrapTransaction("BEGIN EXCLUSIVE"),
    };
  }

  static async create(initSqlJs: SqlJsInit): Promise<WasmDatabase> {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/sql.js@1.14.0/dist/${file}`,
    });
    return new WasmDatabase(new SQL.Database());
  }
}
