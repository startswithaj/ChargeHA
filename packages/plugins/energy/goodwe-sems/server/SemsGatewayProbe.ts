import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import type { SemsPowerflow, SemsToken } from "./GoodweSemsClient.ts";

// Shadow-mode migration probe for the 2026-08-30 legacy portal shutdown.
// Fetches the native SEMS+ gateway flow endpoint and logs the raw response
// beside the legacy powerflow it should mirror, so a running install captures
// the undocumented daylight response shape. The result is never used, failures
// never affect the poll, and the whole thing lives in this file so it can be
// deleted once the native backend is implemented.
//
// The gateway refuses tokens from the plain cross-login our data client uses
// (C0602 account_login_abnormal): SEMS+ runs a dual-session model, and gateway
// routes require a token minted by a "web" login — the same cross-login URL
// and body, but carrying the semsPlusWeb bootstrap Token header plus an
// X-Signature computed with empty uid/token (TimSoethout PR #205; ioBroker
// HAR captures). The probe therefore holds its own web token, independent of
// the legacy session that powers the real polls.
//
// Off by default; enable with GOODWE_SEMS_GATEWAY_PROBE=1.

const PROBE_INTERVAL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const WEB_LOGIN_BOOTSTRAP_TOKEN =
  '{"uid":"","timestamp":0,"token":"","client":"semsPlusWeb","version":"","language":"en"}';

const SUCCESS_CODES: ReadonlySet<string> = new Set(["0", "00000"]);
const STALE_WEB_TOKEN_CODE = "C0602";

function probeEnabled(): boolean {
  if (Deno.env.get("GOODWE_SEMS_GATEWAY_PROBE") !== "1") return false;
  // A base override means we are talking to the local fake, which has no
  // gateway routes.
  return !Deno.env.get("GOODWE_SEMS_BASE_URL");
}

function tokenRegion(token: SemsToken): string {
  if (typeof token.region === "string" && token.region) return token.region;
  const api = token.api.replace(/\/$/, "");
  const host = api.split("//").at(-1)?.split("/")[0] ?? "";
  return host.split(/[.-]/)[0] || "au";
}

function gatewayBase(token: SemsToken): string {
  const api = token.api.replace(/\/$/, "");
  if (api.includes("-gateway.semsportal.com")) return api;
  return `https://${tokenRegion(token)}-gateway.semsportal.com/web/sems`;
}

function webLoginUrls(region: string): string[] {
  const path = "/web/sems/sems-user/api/v1/auth/cross-login";
  return [
    `https://${region}-semsplus.goodwe.com${path}`,
    `https://semsplus.goodwe.com${path}`,
  ];
}

// X-Signature the SEMS+ web app sends on every request:
// base64(sha256hex("{ms}@{uid}@{token}") + "@" + ms), recomputed per request.
// uid and token are empty strings on the login call itself.
async function signature(uid: string, inner: string): Promise<string> {
  const ms = Date.now();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ms}@${uid}@${inner}`),
  );
  return btoa(`${encodeHex(new Uint8Array(digest))}@${ms}`);
}

async function encodeWebPassword(password: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(password),
  );
  return btoa(encodeHex(new Uint8Array(digest)));
}

// The gateway rejects non-browser identities, so mimic the SEMS+ web app.
function browserHeaders(region: string): Record<string, string> {
  const origin = `https://${region}-semsplus.goodwe.com`;
  return {
    "Accept": "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": origin,
    "Referer": `${origin}/`,
  };
}

type WebToken = Record<string, unknown>;

export class SemsGatewayProbe {
  private lastProbeAtMs = 0;
  private webToken: WebToken | null = null;

  constructor(
    private readonly account: string,
    private readonly password: string,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
  ) {}

  async probe(
    token: SemsToken,
    stationId: string,
    legacy: SemsPowerflow | null,
  ): Promise<void> {
    if (!probeEnabled()) return;
    const now = Date.now();
    if (now - this.lastProbeAtMs < PROBE_INTERVAL_MS) return;
    this.lastProbeAtMs = now;
    try {
      const region = tokenRegion(token);
      if (!this.webToken) this.webToken = await this.webLogin(region);
      if (!this.webToken) return;
      await this.fetchFlow(token, stationId, legacy);
    } catch (error) {
      this.logger.warn(`SEMS gateway probe failed: ${error}`);
    }
  }

  private async webLogin(region: string): Promise<WebToken | null> {
    const body = JSON.stringify({
      account: this.account,
      pwd: await encodeWebPassword(this.password),
      agreement: 1,
      isChinese: false,
      isLocal: false,
    });
    const headers = {
      ...browserHeaders(region),
      "Content-Type": "application/json",
      "Token": WEB_LOGIN_BOOTSTRAP_TOKEN,
      "X-Signature": await signature("", ""),
    };
    return await webLoginUrls(region).reduce<Promise<WebToken | null>>(
      async (carry, url) =>
        (await carry) ?? this.webLoginAt(url, body, headers),
      Promise.resolve(null),
    );
  }

  private async webLoginAt(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<WebToken | null> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = await response.json() as {
        code?: string | number;
        data?: WebToken;
      };
      const code = String(json.code ?? "");
      if (!SUCCESS_CODES.has(code) || !json.data?.token) {
        this.logger.warn(
          `SEMS gateway probe web login rejected at ${url} (code ${code})`,
        );
        return null;
      }
      this.logger.info(`SEMS gateway probe web login succeeded via ${url}`);
      return json.data;
    } catch (error) {
      this.logger.warn(`SEMS gateway probe web login unreachable: ${error}`);
      return null;
    }
  }

  private async fetchFlow(
    token: SemsToken,
    stationId: string,
    legacy: SemsPowerflow | null,
  ): Promise<void> {
    const web = this.webToken;
    if (!web) return;
    const url = `${gatewayBase(token)}/sems-plant/api/stations/flow?stationId=${
      encodeURIComponent(stationId)
    }`;
    const uid = String(web.uid ?? "");
    const inner = String(web.token ?? "");
    const headers = {
      ...browserHeaders(tokenRegion(token)),
      "token": JSON.stringify({ ...web, client: "semsPlusWeb" }),
      "X-Signature": await signature(uid, inner),
    };
    const startedAt = performance.now();
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Some APIs echo auth material back in error responses — scrub the web
    // session token and uid before the body reaches any log.
    const body = this.redact((await response.text()).slice(0, 4000));
    const durationMs = Math.round(performance.now() - startedAt);
    if (body.includes(STALE_WEB_TOKEN_CODE)) this.webToken = null;
    this.logger.info(
      `SEMS gateway probe ${url} → HTTP ${response.status} in ${durationMs}ms: ${body}`,
    );
    this.dbLog.info("SEMS gateway flow probe", {
      payload: { url, status: response.status, body, legacy },
    });
  }

  private redact(body: string): string {
    const web = this.webToken ?? {};
    return [String(web.token ?? ""), String(web.uid ?? "")]
      .filter((secret) => secret.length >= 8)
      .reduce(
        (scrubbed, secret) => scrubbed.replaceAll(secret, "REDACTED"),
        body,
      );
  }
}
