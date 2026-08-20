import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import {
  GoodweSemsAuthError,
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "../errors.ts";
import {
  FLOW,
  LOGIN,
  RATE_LIMIT_BACKOFF_MS,
  RATE_LIMIT_CODE,
  REJECTED_LOGIN_COOLDOWN_MS,
  REQUEST_TIMEOUT_MS,
  type SemsPlusEndpoint,
  STALE_TOKEN_CODES,
  STATION_LIST,
  STATION_LIST_BODY,
  SUCCESS_CODES,
} from "./GoodweSemsPlusProtocol.ts";
import {
  encodePassword,
  FALLBACK_GATEWAY,
  gatewayHeaders,
  gatewayUrl,
  hostRegion,
  loginHeaders,
  loginHosts,
  type SemsPlusToken,
} from "./GoodweSemsPlusHelpers.ts";
import {
  loginEnvelopeSchema,
  parseFlow,
  parseStations,
  type SemsPlusFlow,
  type SemsPlusStation,
} from "./GoodweSemsPlusTypes.ts";

export class GoodweSemsPlusClient {
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

  async getFlow(stationId: string): Promise<SemsPlusFlow> {
    return await this.call(FLOW, { query: { stationId } }, parseFlow);
  }

  async getStations(): Promise<SemsPlusStation[]> {
    return await this.call(
      STATION_LIST,
      { body: STATION_LIST_BODY },
      (data) => {
        const stations = parseStations(data);
        if (stations !== null) return stations;
        this.logger.warn("SEMS+ station list arrived in an unrecognised shape");
        return [];
      },
    );
  }

  // The one place that owns the gateway envelope: auth, rate limits, the
  // single stale-token retry and the success codes. Endpoints only parse data.
  private async call<T>(
    endpoint: SemsPlusEndpoint,
    request: { query?: Record<string, string>; body?: unknown },
    parse: (data: unknown) => T,
    isRetry = false,
  ): Promise<T> {
    await this.ensureLoggedIn();
    const token = this.token;
    if (!token) throw new GoodweSemsAuthError("SEMS+ login produced no token");

    const json = await this.send(endpoint, token, request);
    const code = String(json.code ?? "");

    if (code === RATE_LIMIT_CODE) {
      this.logFailure(endpoint, `code ${code}`, isRetry);
      throw new GoodweSemsRateLimitError(RATE_LIMIT_BACKOFF_MS);
    }
    if (!isRetry && STALE_TOKEN_CODES.has(code)) {
      this.logger.debug("SEMS+ token stale — re-authenticating and retrying");
      this.token = null;
      return await this.call(endpoint, request, parse, true);
    }
    if (!SUCCESS_CODES.has(code)) {
      this.logFailure(endpoint, `code ${code || "(none)"}`, isRetry);
      throw new GoodweSemsConnectionError(
        `SEMS+ ${endpoint.label} failed with code ${code || "(none)"}`,
      );
    }
    return this.parseOrThrow(endpoint, json.data, parse, isRetry);
  }

  private parseOrThrow<T>(
    endpoint: SemsPlusEndpoint,
    data: unknown,
    parse: (data: unknown) => T,
    isRetry: boolean,
  ): T {
    try {
      return parse(data);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logFailure(endpoint, reason, isRetry);
      throw new GoodweSemsConnectionError(reason);
    }
  }

  private async send(
    endpoint: SemsPlusEndpoint,
    token: SemsPlusToken,
    request: { query?: Record<string, string>; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const url = gatewayUrl(token, endpoint, request.query);
    const headers = await gatewayHeaders(token);
    const startedAt = performance.now();
    const response = await this.fetchOrThrow(url, {
      method: endpoint.method,
      headers: request.body === undefined
        ? headers
        : { ...headers, "Content-Type": "application/json" },
      body: request.body === undefined
        ? undefined
        : JSON.stringify(request.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const durationMs = Math.round(performance.now() - startedAt);
    this.logger.info(
      `SEMS+ ${endpoint.label} → HTTP ${response.status} in ${durationMs}ms`,
    );
    if (!response.ok) {
      this.logFailure(endpoint, `HTTP ${response.status}`, false);
      throw new GoodweSemsConnectionError(
        `SEMS+ gateway returned HTTP ${response.status} for the ${endpoint.label}`,
      );
    }
    return await response.json() as Record<string, unknown>;
  }

  private async fetchOrThrow(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new GoodweSemsConnectionError(
        `Failed to reach SEMS+ gateway at ${url}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private logFailure(
    endpoint: SemsPlusEndpoint,
    reason: string,
    isRetry: boolean,
  ): void {
    const summary = `SEMS+ ${endpoint.label} failed — ${reason}${
      isRetry ? " (retry)" : ""
    }`;
    this.logger.warn(summary);
    this.dbLog.warn(summary, {
      payload: { endpoint: endpoint.path, reason, isRetry },
    });
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
        const outcome = await this.attemptLoginAt(`${host}${LOGIN.path}`, body);
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
        method: LOGIN.method,
        headers: await loginHeaders(hostRegion(url)),
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
