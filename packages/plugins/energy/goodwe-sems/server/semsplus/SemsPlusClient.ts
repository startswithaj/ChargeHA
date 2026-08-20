import { z } from "zod";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import {
  GoodweSemsAuthError,
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "../errors.ts";
import {
  encodePassword,
  FALLBACK_GATEWAY,
  gatewayBase,
  gatewayHeaders,
  LOGIN_PATH,
  loginHosts,
  type SemsPlusToken,
  stationEntries,
} from "./helpers.ts";
import {
  type SemsPlusFlow,
  semsPlusFlowSchema,
  type SemsPlusStation,
  semsPlusStationPageSchema,
} from "./types.ts";

const SUCCESS_CODES: ReadonlySet<string> = new Set(["0", "00000"]);
// Rejected credentials can't fix themselves — don't hammer rate-limited CrossLogin.
const REJECTED_LOGIN_COOLDOWN_MS = 5 * 60 * 1000;
const STALE_TOKEN_CODES: ReadonlySet<string> = new Set(["100002", "C0602"]);
const RATE_LIMIT_CODE = "GY0429";
const RATE_LIMIT_BACKOFF_MS = 300_000;
const REQUEST_TIMEOUT_MS = 15_000;

const loginEnvelopeSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  api: z.string().optional(),
  data: z.object({ token: z.string().optional(), api: z.string().optional() })
    .passthrough().optional(),
}).passthrough();

export class SemsPlusClient {
  private token: SemsPlusToken | null = null;
  private loginPromise: Promise<void> | null = null;
  private lastRejectedAtMs = 0;

  constructor(
    private readonly account: string,
    private readonly password: string,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
  ) {}

  clearSession(): void {
    this.token = null;
  }

  async getFlow(stationId: string, isRetry = false): Promise<SemsPlusFlow> {
    await this.ensureLoggedIn();
    const token = this.token;
    if (!token) throw new GoodweSemsAuthError("SEMS+ login produced no token");

    const url = `${gatewayBase(token)}/sems-plant/api/stations/flow?stationId=${
      encodeURIComponent(stationId)
    }`;
    const startedAt = performance.now();
    const response = await this.fetchFlow(url, token);
    const durationMs = Math.round(performance.now() - startedAt);
    this.logger.info(
      `SEMS+ flow → HTTP ${response.status} in ${durationMs}ms`,
    );
    if (!response.ok) {
      this.logFlowFailure(stationId, `HTTP ${response.status}`, isRetry);
      throw new GoodweSemsConnectionError(
        `SEMS+ gateway returned HTTP ${response.status}`,
      );
    }
    const json = await response.json() as Record<string, unknown>;
    const code = String(json.code ?? "");
    if (code === RATE_LIMIT_CODE) {
      this.logFlowFailure(stationId, `code ${code}`, isRetry);
      throw new GoodweSemsRateLimitError(RATE_LIMIT_BACKOFF_MS);
    }
    if (!isRetry && STALE_TOKEN_CODES.has(code)) {
      this.logger.debug("SEMS+ token stale — re-authenticating and retrying");
      this.token = null;
      return await this.getFlow(stationId, true);
    }
    if (!SUCCESS_CODES.has(code)) {
      this.logFlowFailure(stationId, `code ${code || "(none)"}`, isRetry);
      throw new GoodweSemsConnectionError(
        `SEMS+ flow failed with code ${code || "(none)"}`,
      );
    }
    const parsed = semsPlusFlowSchema.safeParse(json.data);
    if (!parsed.success) {
      this.logFlowFailure(stationId, "unrecognised payload shape", isRetry);
      throw new GoodweSemsConnectionError(
        "SEMS+ flow payload arrived in an unrecognised shape",
      );
    }
    // A parseable but empty flow is what the gateway returns for an unknown
    // or un-migrated station — all-zero readings must not pass as good data.
    if (parsed.data.pGrid == null && parsed.data.pConsum == null) {
      this.logFlowFailure(
        stationId,
        "payload carried no power fields",
        isRetry,
      );
      throw new GoodweSemsConnectionError(
        "SEMS+ returned no power flow data for this station — a GoodWe " +
          "HomeKit or smart meter is required for grid and consumption " +
          "readings, and the station must appear in the SEMS+ app",
      );
    }
    return parsed.data;
  }

  private logFlowFailure(
    stationId: string,
    reason: string,
    isRetry: boolean,
  ): void {
    const summary = `SEMS+ flow failed — ${reason}${isRetry ? " (retry)" : ""}`;
    this.logger.warn(summary);
    this.dbLog.warn(summary, { payload: { stationId, reason, isRetry } });
  }

  async getStations(isRetry = false): Promise<SemsPlusStation[]> {
    await this.ensureLoggedIn();
    const token = this.token;
    if (!token) throw new GoodweSemsAuthError("SEMS+ login produced no token");

    const url = `${gatewayBase(token)}/sems-plant/api/stations/simple-query`;
    const response = await this.fetchGateway(url, token, {
      current: 1,
      size: 100,
    });
    if (!response.ok) {
      throw new GoodweSemsConnectionError(
        `SEMS+ gateway returned HTTP ${response.status} for the station list`,
      );
    }
    const json = await response.json() as Record<string, unknown>;
    const code = String(json.code ?? "");
    if (code === RATE_LIMIT_CODE) {
      throw new GoodweSemsRateLimitError(RATE_LIMIT_BACKOFF_MS);
    }
    if (!isRetry && STALE_TOKEN_CODES.has(code)) {
      this.token = null;
      return await this.getStations(true);
    }
    if (!SUCCESS_CODES.has(code)) {
      throw new GoodweSemsConnectionError(
        `SEMS+ station list failed with code ${code || "(none)"}`,
      );
    }
    const parsed = semsPlusStationPageSchema.safeParse(json.data);
    if (!parsed.success) {
      this.logger.warn(
        `SEMS+ station list arrived in an unrecognised shape: ${parsed.error.message}`,
      );
      return [];
    }
    return stationEntries(parsed.data).flatMap((entry) => {
      const id = entry.id ?? entry.plantId;
      if (id === null || id === undefined) return [];
      const name = entry.name ?? entry.plantName ?? entry.stationName;
      return [{ id: String(id), name: name || String(id) }];
    });
  }

  private async fetchGateway(
    url: string,
    token: SemsPlusToken,
    body: Record<string, unknown>,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          ...await gatewayHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GoodweSemsConnectionError(
        `Failed to reach SEMS+ gateway at ${url}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async fetchFlow(
    url: string,
    token: SemsPlusToken,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: "GET",
        headers: await gatewayHeaders(token),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GoodweSemsConnectionError(
        `Failed to reach SEMS+ gateway at ${url}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async ensureLoggedIn(): Promise<void> {
    if (this.token) return;
    if (Date.now() - this.lastRejectedAtMs < REJECTED_LOGIN_COOLDOWN_MS) {
      throw new GoodweSemsAuthError(
        "SEMS+ login rejected — check the account email and password",
      );
    }
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  private async login(): Promise<void> {
    const body = {
      account: this.account,
      pwd: await encodePassword(this.password),
      agreement: 1,
      isChinese: false,
      isLocal: false,
    };
    const result = await loginHosts().reduce<
      Promise<{ token: SemsPlusToken | null; sawRejection: boolean }>
    >(
      async (carry, host) => {
        const acc = await carry;
        // Both hosts front the same auth system — a definitive rejection from
        // one is final, and retrying the other just doubles login volume.
        if (acc.token || acc.sawRejection) return acc;
        const outcome = await this.attemptLoginAt(`${host}${LOGIN_PATH}`, body);
        if (outcome === "rejected") return { ...acc, sawRejection: true };
        if (outcome === "unreachable") return acc;
        return { ...acc, token: outcome };
      },
      Promise.resolve({ token: null, sawRejection: false }),
    );
    if (result.token) {
      this.token = result.token;
      return;
    }
    // Only blame the password when a host actually rejected it.
    if (result.sawRejection) {
      this.lastRejectedAtMs = Date.now();
      throw new GoodweSemsAuthError(
        "SEMS+ login rejected — check the account email and password",
      );
    }
    throw new GoodweSemsConnectionError(
      "SEMS+ is unreachable — check your internet connection and try again later",
    );
  }

  private async attemptLoginAt(
    url: string,
    body: Record<string, unknown>,
  ): Promise<SemsPlusToken | "rejected" | "unreachable"> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, */*;q=0.5",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`SEMS+ login HTTP ${response.status} at ${url}`);
        return "unreachable";
      }
      const json = await response.json() as Record<string, unknown>;
      const code = String(json.code ?? "");
      if (code === RATE_LIMIT_CODE) {
        throw new GoodweSemsRateLimitError(RATE_LIMIT_BACKOFF_MS);
      }
      const envelope = loginEnvelopeSchema.safeParse(json);
      if (
        !SUCCESS_CODES.has(code) || !envelope.success ||
        !envelope.data.data?.token
      ) {
        this.logger.warn(`SEMS+ login rejected (code ${code})`);
        this.dbLog.warn("SEMS+ login rejected", { payload: { code } });
        return "rejected";
      }
      const payload = envelope.data.data;
      const api = envelope.data.api ?? payload.api ?? FALLBACK_GATEWAY;
      this.logger.info(`SEMS+ login succeeded — api base ${api}`);
      this.dbLog.info("SEMS+ login succeeded", { payload: { api } });
      return { ...payload, api };
    } catch (error) {
      if (error instanceof GoodweSemsRateLimitError) throw error;
      this.logger.warn(`SEMS+ login unreachable at ${url}: ${error}`);
      return "unreachable";
    }
  }
}
