import https from "node:https";
import type { Logger } from "@chargeha/server/lib/Logger";
import { INFO_PATH, tagValue } from "./envoyInfo.ts";

const ENLIGHTEN_LOGIN_URL =
  "https://enlighten.enphaseenergy.com/login/login.json";
const ENTREZ_TOKEN_URL = "https://entrez.enphaseenergy.com/tokens";
const REQUEST_TIMEOUT_MS = 10000;
// Refresh the (1-year) owner token when less than this remains before expiry.
const TOKEN_RENEW_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;
// After the Envoy rejects a freshly fetched token, hold off further cloud
// logins for this long — repeated logins risk an Enphase account lockout.
const AUTH_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

export class EnphaseAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "EnphaseAuthError";
  }
}

export class EnphaseConnectionError extends Error {
  constructor(message: string, cause?: Error, readonly status?: number) {
    super(message, { cause });
    this.name = "EnphaseConnectionError";
  }
}

/**
 * Minimal HTTPS-GET surface for talking to the Envoy on the LAN. Implemented
 * with node:https in production (the Envoy's certificate is self-signed, so
 * Deno's fetch rejects it) and by a fake in tests.
 */
export interface EnvoyHttp {
  get(
    host: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }>;
}

/** node:https GET with certificate verification disabled — the Envoy serves a
 *  self-signed certificate on the LAN, which is expected for this device.
 *  Network discovery passes a short timeout so subnet sweeps don't stall. */
export const makeNodeHttpsEnvoyHttp = (
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): EnvoyHttp => ({
  get(host, path, headers) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host,
          port: 443,
          path,
          method: "GET",
          headers,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Uint8Array[] = [];
          res.on("data", (c: Uint8Array) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: new TextDecoder().decode(concat(chunks)),
            }));
        },
      );
      req.on("timeout", () => {
        req.destroy(new Error(`timed out after ${timeoutMs}ms`));
      });
      req.on(
        "error",
        (err: Error) =>
          reject(
            new EnphaseConnectionError(
              `Envoy request to https://${host}${path} failed: ${err.message}`,
              err,
            ),
          ),
      );
      req.end();
    });
  },
});

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  chunks.reduce((offset, c) => {
    out.set(c, offset);
    return offset + c.length;
  }, 0);
  return out;
}

/** Decode a JWT's `exp` claim (ms since epoch), or null if unparseable. */
export function tokenExpiryMs(token: string): number | null {
  try {
    // JWT payloads are base64url; atob only accepts the standard alphabet.
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface EnphaseAuth {
  email: string;
  password: string;
  /** User-pasted token; when set it is used as-is and never renewed. */
  manualToken: string;
  /** Last token fetched via credentials (persisted between restarts). */
  cachedToken: string;
}

/**
 * Authenticated JSON client for the Envoy local API (firmware 7+).
 *
 * Token strategy: a manually pasted token always wins; otherwise the cached
 * credential-fetched token is used until it nears expiry, then a fresh owner
 * token is fetched from Enphase's cloud (login → entrez) and persisted via
 * `persistToken`. A 401 from the Envoy invalidates the cached token and
 * retries once with a fresh one.
 */
export class EnphaseClient {
  private cachedToken: string;
  private refreshRejectedUntil = 0;

  constructor(
    readonly host: string,
    private readonly auth: EnphaseAuth,
    private readonly persistToken: (token: string) => Promise<void>,
    private readonly logger: Logger,
    private readonly http: EnvoyHttp = makeNodeHttpsEnvoyHttp(),
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.cachedToken = auth.cachedToken;
  }

  /** GET an unauthenticated local endpoint and return the raw body.
   *  `/info` needs no token and returns XML on all firmware versions. */
  async getRaw(path: string): Promise<string> {
    const res = await this.http.get(this.host, path, {});
    if (res.status < 200 || res.status >= 300) {
      throw new EnphaseConnectionError(
        `Envoy ${this.host}${path} returned HTTP ${res.status}`,
        undefined,
        res.status,
      );
    }
    return res.body;
  }

  /** GET a local Envoy endpoint and parse the JSON body. */
  async getJson(path: string): Promise<unknown> {
    const first = await this.request(path, await this.token());
    if (first.status !== 401) return this.parse(path, first);
    if (this.auth.manualToken) {
      throw new EnphaseAuthError(
        "Envoy rejected the configured token (401). Generate a new token and update the plugin settings.",
      );
    }
    if (this.now() < this.refreshRejectedUntil) {
      throw new EnphaseAuthError(
        "Envoy rejected a freshly fetched token — pausing token refresh to avoid an Enphase account lockout",
      );
    }
    this.logger.info("Envoy returned 401 — refreshing owner token");
    this.cachedToken = "";
    const retry = await this.request(path, await this.token());
    if (retry.status === 401) {
      this.refreshRejectedUntil = this.now() + AUTH_RETRY_COOLDOWN_MS;
    }
    return this.parse(path, retry);
  }

  private async token(): Promise<string> {
    if (this.auth.manualToken) return this.auth.manualToken;
    if (this.cachedToken && !this.isExpiring(this.cachedToken)) {
      return this.cachedToken;
    }
    // The cooldown is gated here rather than only on the 401 path: every route
    // to the cloud login runs through this method, and a failed login leaves
    // the cache empty, so the next poll would come straight back in and log in
    // again — the account lockout this cooldown exists to prevent.
    if (this.now() < this.refreshRejectedUntil) {
      throw new EnphaseAuthError(
        "Pausing Enphase cloud token refresh after a failed attempt, to avoid an account lockout",
      );
    }
    try {
      const fresh = await this.fetchOwnerToken();
      this.cachedToken = fresh;
      await this.persistToken(fresh);
      return fresh;
    } catch (err) {
      this.refreshRejectedUntil = this.now() + AUTH_RETRY_COOLDOWN_MS;
      throw err;
    }
  }

  private isExpiring(token: string): boolean {
    const expiry = tokenExpiryMs(token);
    if (expiry === null) {
      this.logger.warn(
        "Cached Enphase token payload is unparseable — treating it as expiring and fetching a fresh one",
      );
      return true;
    }
    return expiry - this.now() < TOKEN_RENEW_MARGIN_MS;
  }

  /** Login to Enlighten, then exchange the session for an owner token. */
  private async fetchOwnerToken(): Promise<string> {
    if (!this.auth.email || !this.auth.password) {
      throw new EnphaseAuthError(
        "No valid token and no Enphase credentials configured",
      );
    }
    this.logger.info("Fetching Enphase owner token from cloud");
    // Entrez issues tokens per gateway serial; the device at `host` knows its
    // own serial, so read it from /info rather than storing it as config.
    const serial = await this.resolveSerial();
    const sessionId = await this.login();
    const res = await this.fetchFn(ENTREZ_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        serial_num: serial,
        username: this.auth.email,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new EnphaseAuthError(
        `Token request failed: HTTP ${res.status} from entrez${
          detail ? ` — ${detail}` : ""
        }`,
      );
    }
    const token = (await res.text()).trim();
    if (!token) throw new EnphaseAuthError("Entrez returned an empty token");
    return token;
  }

  private async resolveSerial(): Promise<string> {
    const serial = tagValue(await this.getRaw(INFO_PATH), "sn");
    if (!serial) {
      throw new EnphaseConnectionError("Envoy /info returned no serial");
    }
    return serial;
  }

  private async login(): Promise<string> {
    const form = new URLSearchParams({
      "user[email]": this.auth.email,
      "user[password]": this.auth.password,
    });
    const res = await this.fetchFn(ENLIGHTEN_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new EnphaseAuthError(
        `Enphase login failed: HTTP ${res.status} — check email/password${
          detail ? ` (${detail})` : ""
        }`,
      );
    }
    const json = await res.json().catch(() => null);
    if (!json?.session_id) {
      throw new EnphaseAuthError("Enphase login response had no session_id");
    }
    return json.session_id;
  }

  private request(path: string, token: string) {
    return this.http.get(this.host, path, {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    });
  }

  private parse(
    path: string,
    res: { status: number; body: string },
  ): unknown {
    if (res.status < 200 || res.status >= 300) {
      throw new EnphaseConnectionError(
        `Envoy ${this.host}${path} returned HTTP ${res.status}`,
        undefined,
        res.status,
      );
    }
    try {
      return JSON.parse(res.body);
    } catch (err) {
      throw new EnphaseConnectionError(
        `Envoy ${this.host}${path} returned invalid JSON: ${
          res.body.slice(0, 200)
        }`,
        err instanceof Error ? err : undefined,
      );
    }
  }
}
