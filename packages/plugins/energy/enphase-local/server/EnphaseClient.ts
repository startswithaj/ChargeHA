import https from "node:https";
import type { Logger } from "@chargeha/server/lib/Logger";

const ENLIGHTEN_LOGIN_URL =
  "https://enlighten.enphaseenergy.com/login/login.json";
const ENTREZ_TOKEN_URL = "https://entrez.enphaseenergy.com/tokens";
const REQUEST_TIMEOUT_MS = 10000;
// Refresh the (1-year) owner token when less than this remains before expiry.
const TOKEN_RENEW_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

export class EnphaseAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "EnphaseAuthError";
  }
}

export class EnphaseConnectionError extends Error {
  constructor(message: string, cause?: Error) {
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
        req.destroy(new Error(`Timed out requesting ${path}`));
      });
      req.on(
        "error",
        (err: Error) =>
          reject(
            new EnphaseConnectionError(
              `Envoy request failed: ${err.message}`,
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
    const payload = JSON.parse(atob(token.split(".")[1]));
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

  constructor(
    private readonly host: string,
    private readonly serial: string,
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
        `Envoy ${path} returned HTTP ${res.status}`,
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
    this.logger.info("Envoy returned 401 — refreshing owner token");
    this.cachedToken = "";
    const retry = await this.request(path, await this.token());
    return this.parse(path, retry);
  }

  private async token(): Promise<string> {
    if (this.auth.manualToken) return this.auth.manualToken;
    if (this.cachedToken && !this.isExpiring(this.cachedToken)) {
      return this.cachedToken;
    }
    const fresh = await this.fetchOwnerToken();
    this.cachedToken = fresh;
    await this.persistToken(fresh);
    return fresh;
  }

  private isExpiring(token: string): boolean {
    const expiry = tokenExpiryMs(token);
    return expiry === null || expiry - this.now() < TOKEN_RENEW_MARGIN_MS;
  }

  /** Login to Enlighten, then exchange the session for an owner token. */
  private async fetchOwnerToken(): Promise<string> {
    if (!this.auth.email || !this.auth.password) {
      throw new EnphaseAuthError(
        "No valid token and no Enphase credentials configured",
      );
    }
    this.logger.info("Fetching Enphase owner token from cloud");
    const sessionId = await this.login();
    const res = await this.fetchFn(ENTREZ_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        serial_num: this.serial,
        username: this.auth.email,
      }),
    });
    if (!res.ok) {
      throw new EnphaseAuthError(
        `Token request failed: HTTP ${res.status} from entrez`,
      );
    }
    const token = (await res.text()).trim();
    if (!token) throw new EnphaseAuthError("Entrez returned an empty token");
    return token;
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
    });
    if (!res.ok) {
      throw new EnphaseAuthError(
        `Enphase login failed: HTTP ${res.status} — check email/password`,
      );
    }
    const json = await res.json();
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
        `Envoy ${path} returned HTTP ${res.status}`,
      );
    }
    try {
      return JSON.parse(res.body);
    } catch (err) {
      throw new EnphaseConnectionError(
        `Envoy ${path} returned invalid JSON`,
        err instanceof Error ? err : undefined,
      );
    }
  }
}
