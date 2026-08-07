import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { KlapCrypto, type KlapSessionKeys } from "./KlapCrypto.ts";
import { KlapHttp, type KlapHttpResponse } from "./KlapHttp.ts";
import {
  TapoApiError,
  TapoAuthError,
  TapoConnectionError,
  TapoLockedError,
} from "./errors.ts";

interface KlapSession {
  keys: KlapSessionKeys;
  seq: number;
  cookie: string;
}

interface TapoResponse<T> {
  error_code: number;
  result?: T;
}

const REQUEST_TIMEOUT_MS = 5000;

// Tapo's default 10s poll makes two device calls each time; logging every
// success would write ~12 rows/minute/charger for "the poll worked". One row
// per window still proves the poll loop is alive without drowning real faults.
const SUCCESS_LOG_THROTTLE_MS = 5 * 60 * 1000;

/** Speaks KLAP v2 to one device: two-stage seed handshake, then AES-CBC
 *  encrypted JSON requests with per-request sequence numbers. Re-handshakes
 *  once on session expiry (403). */
export class KlapClient {
  private session: KlapSession | null = null;
  // Instance-scoped so two Tapo plugs (two KlapClient instances, one per
  // charger row) throttle independently. Timestamp of the last logged
  // success, or null if the next success should log immediately — either
  // because none has logged yet or because a failure just reset it.
  private lastSuccessLogAt: number | null = null;

  constructor(
    private readonly host: string,
    private readonly email: string,
    private readonly password: string,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
    // Identifies which charger row this client belongs to — PluginDbLogger
    // only scopes by plugin id, and two Tapo plugs would otherwise be
    // indistinguishable in the log table.
    private readonly chargerId: string,
  ) {}

  async handshake(): Promise<void> {
    const start = Date.now();
    // Never log authHash-derived material or the raw email/password —
    // only host and charger identity below.
    const authHash = await KlapCrypto.computeAuthHash(
      this.email,
      this.password,
    );
    const localSeed = crypto.getRandomValues(new Uint8Array(16));

    try {
      const h1 = await this.post("/app/handshake1", localSeed, null);
      // 403 before any credential is exchanged means local control is switched
      // off at the device, not that the account details are wrong.
      if (h1.status === 403) {
        const error = new TapoLockedError(this.host);
        this.dbLog.warn(`Handshake locked out (${this.chargerId})`, {
          payload: { chargerId: this.chargerId, host: this.host },
        });
        throw error;
      }
      if (!h1.ok || h1.body.length !== 48) {
        throw new TapoConnectionError(
          `handshake1 failed (HTTP ${h1.status}, ${h1.body.length} bytes)`,
        );
      }
      const cookie = extractSessionCookie(h1.setCookie);
      const remoteSeed = h1.body.slice(0, 16);
      const expected = await KlapCrypto.serverHash(
        localSeed,
        remoteSeed,
        authHash,
      );
      if (!KlapCrypto.bytesEqual(h1.body.slice(16), expected)) {
        const error = new TapoAuthError();
        this.dbLog.error(`Handshake auth rejected (${this.chargerId})`, {
          payload: { chargerId: this.chargerId, host: this.host },
        });
        throw error;
      }

      const h2Body = await KlapCrypto.handshake2Hash(
        localSeed,
        remoteSeed,
        authHash,
      );
      const h2 = await this.post("/app/handshake2", h2Body, cookie);
      if (!h2.ok) {
        throw new TapoConnectionError(`handshake2 failed (HTTP ${h2.status})`);
      }

      const keys = await KlapCrypto.deriveSessionKeys(
        localSeed,
        remoteSeed,
        authHash,
      );
      this.session = { keys, seq: keys.initialSeq, cookie };
      this.logger.debug(`KLAP session established with ${this.host}`);
      this.dbLog.debug(`Handshake established (${this.chargerId})`, {
        payload: {
          chargerId: this.chargerId,
          host: this.host,
          durationMs: Date.now() - start,
        },
      });
    } catch (error) {
      if (error instanceof TapoLockedError || error instanceof TapoAuthError) {
        throw error;
      }
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      this.dbLog.error(`Handshake failed (${this.chargerId})`, {
        payload: {
          chargerId: this.chargerId,
          host: this.host,
          durationMs: Date.now() - start,
          error: errorMessage,
        },
      });
      throw error;
    }
  }

  async request<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.session) await this.handshake();
    try {
      return await this.send<T>(method, params);
    } catch (error) {
      if (!isSessionExpiry(error)) throw error;
      this.logger.debug(`Session expired for ${this.host}, re-handshaking`);
      this.dbLog.debug(`Session expired (${this.chargerId}), re-handshaking`, {
        payload: { chargerId: this.chargerId, host: this.host, method },
      });
      await this.handshake();
      return await this.send<T>(method, params);
    }
  }

  private async send<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const session = this.session;
    if (!session) throw new TapoConnectionError("No KLAP session");
    const seq = session.seq + 1;
    this.session = { ...session, seq };
    const start = Date.now();

    try {
      const payload = new TextEncoder().encode(
        JSON.stringify(
          params === undefined ? { method } : { method, params },
        ),
      );
      const body = await KlapCrypto.encryptPayload(session.keys, seq, payload);
      const res = await this.post(
        `/app/request?seq=${seq}`,
        body,
        session.cookie,
      );
      if (res.status === 403) {
        throw new SessionExpiredError();
      }
      if (!res.ok) {
        throw new TapoConnectionError(`${method} failed (HTTP ${res.status})`);
      }

      const plaintext = await KlapCrypto.decryptPayload(
        session.keys,
        seq,
        res.body,
      );
      const parsed: TapoResponse<T> = JSON.parse(
        new TextDecoder().decode(plaintext),
      );
      const durationMs = Date.now() - start;
      if (parsed.error_code !== 0) {
        // Device-level rejection (not a transport failure) — always logged,
        // and it also opens the throttle so the next success logs
        // immediately rather than waiting out the window.
        this.lastSuccessLogAt = null;
        this.dbLog.warn(`${method} rejected (${this.chargerId})`, {
          payload: {
            chargerId: this.chargerId,
            method,
            durationMs,
            errorCode: parsed.error_code,
          },
        });
        throw new TapoApiError(parsed.error_code, method);
      }
      if (parsed.result === undefined) {
        throw new TapoConnectionError(`${method} returned no result`);
      }
      // Routine, high-frequency traffic (every poll) — throttled to at most
      // one row per SUCCESS_LOG_THROTTLE_MS per charger, except the first
      // success after a failure (lastSuccessLogAt reset to null), which
      // always logs immediately since a recovery line is the useful one.
      const now = Date.now();
      if (
        this.lastSuccessLogAt === null ||
        now - this.lastSuccessLogAt >= SUCCESS_LOG_THROTTLE_MS
      ) {
        this.dbLog.debug(`${method} (${this.chargerId})`, {
          payload: { chargerId: this.chargerId, method, durationMs },
        });
        this.lastSuccessLogAt = now;
      }
      return parsed.result;
    } catch (error) {
      if (
        error instanceof SessionExpiredError || error instanceof TapoApiError
      ) {
        throw error;
      }
      const durationMs = Date.now() - start;
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      // Every failure is logged, always — no throttling — and it opens the
      // throttle for the next success (see above).
      this.lastSuccessLogAt = null;
      this.dbLog.error(`${method} failed (${this.chargerId})`, {
        payload: {
          chargerId: this.chargerId,
          method,
          durationMs,
          error: errorMessage,
        },
      });
      throw error;
    }
  }

  private post(
    path: string,
    body: Uint8Array<ArrayBuffer>,
    cookie: string | null,
  ): Promise<KlapHttpResponse> {
    return KlapHttp.post(this.host, path, body, cookie, REQUEST_TIMEOUT_MS);
  }
}

class SessionExpiredError extends Error {
  constructor() {
    super("KLAP session expired");
    this.name = "SessionExpiredError";
  }
}

function isSessionExpiry(error: unknown): boolean {
  return error instanceof SessionExpiredError;
}

function extractSessionCookie(header: string | null): string {
  const match = header?.match(/TP_SESSIONID=[^;]+/);
  if (!match) {
    throw new TapoConnectionError("handshake1 returned no TP_SESSIONID cookie");
  }
  return match[0];
}
