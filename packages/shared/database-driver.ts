/**
 * Database driver interface — the contract between AppDatabase/drizzle and
 * the underlying SQLite implementation.
 *
 * Server: implemented by SqliteCompat.ts using @db/sqlite (native FFI)
 * Browser: can be implemented using sql.js (WASM)
 */

export type BindValue =
  | number
  | string
  | symbol
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | Uint8Array
  | BindValue[];

export type BindParameters = BindValue[] | Record<string, BindValue>;

export interface DatabaseStatement {
  all(...params: BindValue[]): Record<string, unknown>[];
  get(...params: BindValue[]): Record<string, unknown> | undefined;
  run(
    ...params: BindValue[]
  ): { changes: number; lastInsertRowid: number };
  raw(): DatabaseRawStatement;
}

export interface DatabaseRawStatement {
  all(...params: BindValue[]): unknown[][];
  get(...params: BindValue[]): unknown[] | undefined;
}

export interface DatabaseDriver {
  prepare(sql: string): DatabaseStatement;
  exec(sql: string): void;
  close(): void;
  transaction<T, R>(
    fn: (tx: T) => R,
  ): {
    deferred: (tx: T) => R;
    immediate: (tx: T) => R;
    exclusive: (tx: T) => R;
  };
}
