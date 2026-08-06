import type { Logger } from "@chargeha/server/lib/Logger";
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

/** Speaks KLAP v2 to one device: two-stage seed handshake, then AES-CBC
 *  encrypted JSON requests with per-request sequence numbers. Re-handshakes
 *  once on session expiry (403). */
export class KlapClient {
  private session: KlapSession | null = null;

  constructor(
    private readonly host: string,
    private readonly email: string,
    private readonly password: string,
    private readonly logger: Logger,
  ) {}

  async handshake(): Promise<void> {
    const authHash = await KlapCrypto.computeAuthHash(
      this.email,
      this.password,
    );
    const localSeed = crypto.getRandomValues(new Uint8Array(16));

    const h1 = await this.post("/app/handshake1", localSeed, null);
    // 403 before any credential is exchanged means local control is switched
    // off at the device, not that the account details are wrong.
    if (h1.status === 403) throw new TapoLockedError(this.host);
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
      throw new TapoAuthError();
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

    const payload = new TextEncoder().encode(
      JSON.stringify(params === undefined ? { method } : { method, params }),
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
    if (parsed.error_code !== 0) {
      throw new TapoApiError(parsed.error_code, method);
    }
    if (parsed.result === undefined) {
      throw new TapoConnectionError(`${method} returned no result`);
    }
    return parsed.result;
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
