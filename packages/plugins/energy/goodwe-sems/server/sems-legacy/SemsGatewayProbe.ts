import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { SemsPowerflow, SemsToken } from "./GoodweSemsTypes.ts";

// Shadow-mode migration probe for the 2026-08-30 legacy portal shutdown.
// Fetches the native SEMS+ gateway flow endpoint and logs the raw response
// beside the legacy powerflow it should mirror, so a running install captures
// the undocumented daylight response shape. The result is never used, failures
// never affect the poll. Delete this and its protocol file once the native
// SEMS+ backend is verified against a live account.
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

import {
  browserHeaders,
  encodeWebPassword,
  gatewayBase,
  PROBE_INTERVAL_MS,
  probeEnabled,
  REQUEST_TIMEOUT_MS,
  signature,
  STALE_WEB_TOKEN_CODE,
  SUCCESS_CODES,
  tokenRegion,
  WEB_LOGIN_BOOTSTRAP_TOKEN,
  webLoginUrls,
  type WebToken,
} from "./SemsGatewayProbeProtocol.ts";

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
