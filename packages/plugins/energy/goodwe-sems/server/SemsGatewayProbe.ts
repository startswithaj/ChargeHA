import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { encodeHex } from "@std/encoding/hex";
import type { SemsPowerflow, SemsToken } from "./GoodweSemsClient.ts";

// Shadow-mode migration probe for the 2026-08-30 legacy portal shutdown.
// Fetches the native SEMS+ gateway flow endpoint and logs the raw response
// beside the legacy powerflow it should mirror, so a running install captures
// the undocumented daylight response shape. The result is never used, failures
// never affect the poll, and the whole thing lives in this file so it can be
// deleted once the native backend is implemented.
//
// Off by default; enable with GOODWE_SEMS_GATEWAY_PROBE=1.

const PROBE_INTERVAL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

function probeEnabled(): boolean {
  if (Deno.env.get("GOODWE_SEMS_GATEWAY_PROBE") !== "1") return false;
  // A base override means we are talking to the local fake, which has no
  // gateway routes.
  return !Deno.env.get("GOODWE_SEMS_BASE_URL");
}

function gatewayBase(token: SemsToken): string {
  const api = token.api.replace(/\/$/, "");
  if (api.includes("-gateway.semsportal.com")) return api;
  const host = api.split("//").at(-1)?.split("/")[0] ?? "";
  const region = typeof token.region === "string" && token.region
    ? token.region
    : host.split(/[.-]/)[0] || "au";
  return `https://${region}-gateway.semsportal.com/web/sems`;
}

/** X-Signature auth the SEMS+ web app sends on every gateway call:
 *  base64(sha256hex("{ms}@{uid}@{token}") + "@" + ms), recomputed per
 *  request, plus the semsPlusWeb client identity in the token header. */
async function gatewayHeaders(
  token: SemsToken,
): Promise<Record<string, string>> {
  const uid = String(token.uid ?? "");
  const inner = String(token.token ?? "");
  const ms = Date.now();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ms}@${uid}@${inner}`),
  );
  return {
    "Accept": "application/json, text/plain, */*",
    "token": JSON.stringify({ ...token, client: "semsPlusWeb" }),
    "X-Signature": btoa(`${encodeHex(new Uint8Array(digest))}@${ms}`),
  };
}

export class SemsGatewayProbe {
  private lastProbeAtMs = 0;

  constructor(
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
      const url = `${
        gatewayBase(token)
      }/sems-plant/api/stations/flow?stationId=${
        encodeURIComponent(stationId)
      }`;
      const startedAt = performance.now();
      const response = await fetch(url, {
        method: "GET",
        headers: await gatewayHeaders(token),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.text()).slice(0, 4000);
      const durationMs = Math.round(performance.now() - startedAt);
      this.logger.info(
        `SEMS gateway probe ${url} → HTTP ${response.status} in ${durationMs}ms: ${body}`,
      );
      this.dbLog.info("SEMS gateway flow probe", {
        payload: { url, status: response.status, body, legacy },
      });
    } catch (error) {
      this.logger.warn(`SEMS gateway probe failed: ${error}`);
    }
  }
}
