import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, lt, ne, sql } from "drizzle-orm";
import { authLocal, authOidc, sessions as sessionsTable } from "../Schema.ts";
import type {
  CreateLocalUserInput,
  CreateSessionInput,
  LocalUserRow,
  OidcConfigRow,
  SessionRow,
  UpsertOidcConfigInput,
} from "../types.ts";

export class SessionRepository {
  constructor(private db: BetterSQLite3Database) {}

  // ---- Auth: Local users ----

  async createLocalUser(input: CreateLocalUserInput): Promise<LocalUserRow> {
    const result = await this.db
      .insert(authLocal)
      .values({
        username: input.username,
        passwordHash: input.passwordHash,
      })
      .returning();
    const row = result[0];
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getLocalUser(username: string): Promise<LocalUserRow | null> {
    const rows = await this.db
      .select()
      .from(authLocal)
      .where(eq(authLocal.username, username));
    if (rows.length === 0) return null;
    return rows[0] as unknown as LocalUserRow;
  }

  /** Get the first local user (single-tenant convenience). */
  async getFirstLocalUser(): Promise<LocalUserRow | null> {
    const rows = await this.db.select().from(authLocal).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async updateLocalUserPassword(
    username: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db
      .update(authLocal)
      .set({ passwordHash, updatedAt: sql`datetime('now')` })
      .where(eq(authLocal.username, username));
  }

  async deleteAllLocalUsers(): Promise<void> {
    await this.db.delete(authLocal);
  }

  // ---- Auth: OIDC configuration ----

  async upsertOidcConfig(input: UpsertOidcConfigInput): Promise<OidcConfigRow> {
    // Delete existing rows (single-tenant: only one OIDC config at a time)
    await this.db.delete(authOidc);
    const result = await this.db
      .insert(authOidc)
      .values({
        issuerUrl: input.issuerUrl,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        isEncrypted: input.isEncrypted ? 1 : 0,
        baseUrl: input.baseUrl,
      })
      .returning();
    const row = result[0];
    return {
      ...row,
      isEncrypted: row.isEncrypted === 1,
    } as unknown as OidcConfigRow;
  }

  async getOidcConfig(): Promise<OidcConfigRow | null> {
    const rows = await this.db.select().from(authOidc).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      ...row,
      isEncrypted: row.isEncrypted === 1,
    } as unknown as OidcConfigRow;
  }

  async deleteOidcConfig(): Promise<void> {
    await this.db.delete(authOidc);
  }

  async deleteAllOidcConfigs(): Promise<void> {
    await this.db.delete(authOidc);
  }

  // ---- Auth: Sessions ----

  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    const result = await this.db
      .insert(sessionsTable)
      .values({
        id: input.id,
        authType: input.authType,
        identifier: input.identifier,
        email: input.email ?? null,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .returning();
    return result[0] as SessionRow;
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id));
    if (rows.length === 0) return null;
    return rows[0] as SessionRow;
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.delete(sessionsTable).where(eq(sessionsTable.id, id));
  }

  async deleteAllSessions(): Promise<void> {
    await this.db.delete(sessionsTable);
  }

  async deleteSessionsExcept(exceptId: string): Promise<void> {
    await this.db
      .delete(sessionsTable)
      .where(ne(sessionsTable.id, exceptId));
  }

  async deleteExpiredSessions(): Promise<void> {
    const nowSecs = Math.floor(Date.now() / 1000);
    await this.db
      .delete(sessionsTable)
      .where(lt(sessionsTable.expiresAt, nowSecs));
  }
}
