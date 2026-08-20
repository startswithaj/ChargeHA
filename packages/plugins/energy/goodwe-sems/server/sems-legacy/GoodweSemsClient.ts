import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import {
  GoodweSemsAuthError,
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "../errors.ts";
import { SemsGatewayProbe } from "./SemsGatewayProbe.ts";
import {
  EMPTY_RETRY_COOLDOWN_MS,
  encodeSemsPlusPassword,
  isEmptyData,
  LEGACY_API_FALLBACK,
  legacyLoginUrl,
  loginHeaders,
  type LoginMode,
  newLoginUrls,
  RATE_LIMIT_BACKOFF_MS,
  RATE_LIMIT_CODE,
  REJECTED_LOGIN_COOLDOWN_MS,
  REQUEST_TIMEOUT_MS,
  resolveApiBase,
  resolveLoginApi,
  STALE_TOKEN_CODES,
  STATION_DETAIL_PATH,
  STATION_LIST_PATH,
  SUCCESS_CODES,
} from "./GoodweSemsProtocol.ts";
import {
  type GoodweSemsStationReader,
  loginEnvelopeSchema,
  type SemsPowerflow,
  type SemsStationDetail,
  type SemsStationSummary,
  type SemsToken,
  stationDetailSchema,
  stationListSchema,
  toStationDetail,
} from "./GoodweSemsTypes.ts";

export class GoodweSemsClient implements GoodweSemsStationReader {
  private token: SemsToken | null = null;
  private preferredMode: LoginMode | null = null;
  private readonly gatewayProbe: SemsGatewayProbe;
  private loginPromise: Promise<void> | null = null;
  private lastEmptyRetryAtMs = 0;
  private lastRejectedAtMs = 0;

  constructor(
    private readonly account: string,
    private readonly password: string,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
  ) {
    this.gatewayProbe = new SemsGatewayProbe(account, password, logger, dbLog);
  }

  clearSession(): void {
    this.token = null;
  }

  private async ensureLoggedIn(): Promise<void> {
    if (this.token) return;
    if (Date.now() - this.lastRejectedAtMs < REJECTED_LOGIN_COOLDOWN_MS) {
      throw new GoodweSemsAuthError(
        "SEMS login rejected — check the account email and password",
      );
    }
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  async login(): Promise<void> {
    const modes: LoginMode[] = this.preferredMode === "legacy"
      ? ["legacy", "new"]
      : ["new", "legacy"];

    const result = await modes.reduce<
      Promise<{ token: SemsToken | null; sawRejection: boolean }>
    >(
      async (carry, mode) => {
        const acc = await carry;
        if (acc.token) return acc;
        const attempt = await this.attemptLogin(mode);
        if (attempt === "rejected") return { ...acc, sawRejection: true };
        if (attempt === "unreachable") return acc;
        this.preferredMode = mode;
        return { ...acc, token: attempt };
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
        "SEMS login rejected — check the account email and password",
      );
    }
    throw new GoodweSemsConnectionError(
      "SEMS is unreachable — check your internet connection and try again later",
    );
  }

  async probeGatewayFlow(
    stationId: string,
    legacy: SemsPowerflow | null,
  ): Promise<void> {
    if (!this.token) return;
    await this.gatewayProbe.probe(this.token, stationId, legacy);
  }

  async getStations(): Promise<SemsStationSummary[]> {
    const data = await this.call(STATION_LIST_PATH, null);
    this.logger.debug(`SEMS raw station list: ${JSON.stringify(data)}`);
    if (typeof data === "string") {
      return [{ id: data, name: data }];
    }
    const parsed = stationListSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.warn(
        `SEMS station list arrived in an unrecognised shape: ${parsed.error.message}`,
      );
      return [];
    }
    return parsed.data.flatMap((entry) => {
      const id = entry.id ?? entry.powerstation_id;
      if (!id) return [];
      return [{ id, name: entry.stationname || id }];
    });
  }

  async getStationDetail(stationId: string): Promise<SemsStationDetail> {
    const raw = await this.call(STATION_DETAIL_PATH, {
      powerStationId: stationId,
    });

    this.logger.debug(`SEMS raw station detail: ${JSON.stringify(raw)}`);
    const parsed = stationDetailSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GoodweSemsConnectionError(
        "SEMS returned a station payload in an unrecognised shape",
      );
    }
    return toStationDetail(parsed.data);
  }

  private async call(
    path: string,
    body: Record<string, unknown> | null,
    isRetry = false,
  ): Promise<unknown> {
    await this.ensureLoggedIn();
    const token = this.token;
    if (!token) throw new GoodweSemsAuthError("SEMS login produced no token");

    const url = this.apiBase(token, path) + path;
    const startedAt = performance.now();
    const json = await this.post(url, body, {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "token": JSON.stringify(token),
    });
    const durationMs = Math.round(performance.now() - startedAt);

    const code = String(json.code ?? "");
    const dataEmpty = isEmptyData(json.data);
    this.logCallOutcome(path, code, dataEmpty, durationMs, isRetry);
    if (code === RATE_LIMIT_CODE) {
      throw new GoodweSemsRateLimitError(RATE_LIMIT_BACKOFF_MS);
    }

    const data = json.data;
    if (SUCCESS_CODES.has(code) && !dataEmpty) return data;

    if (!isRetry && this.shouldRetryWithFreshLogin(code, dataEmpty)) {
      this.logger.debug("SEMS call failed, re-authenticating and retrying");
      this.token = null;
      return await this.call(path, body, true);
    }

    if (SUCCESS_CODES.has(code)) return data;

    throw new GoodweSemsConnectionError(
      `SEMS ${path} failed with code ${code || "(none)"}`,
    );
  }

  private shouldRetryWithFreshLogin(code: string, dataEmpty: boolean): boolean {
    if (STALE_TOKEN_CODES.has(code)) return true;
    if (SUCCESS_CODES.has(code) && dataEmpty) {
      const now = Date.now();
      if (now - this.lastEmptyRetryAtMs < EMPTY_RETRY_COOLDOWN_MS) return false;
      this.lastEmptyRetryAtMs = now;
      return true;
    }
    return false;
  }

  private logCallOutcome(
    path: string,
    code: string,
    dataEmpty: boolean,
    durationMs: number,
    isRetry: boolean,
  ): void {
    const summary = `SEMS ${path} → code ${
      code || "(none)"
    }, dataEmpty=${dataEmpty} in ${durationMs}ms${isRetry ? " (retry)" : ""}`;
    if (SUCCESS_CODES.has(code) && !dataEmpty) {
      this.logger.info(summary);
      return;
    }
    this.logger.warn(summary);
    this.dbLog.warn(`POST ${path}`, {
      payload: { path, code: code || null, dataEmpty, durationMs, isRetry },
    });
  }

  private async attemptLogin(
    mode: LoginMode,
  ): Promise<SemsToken | "rejected" | "unreachable"> {
    const urls = mode === "new" ? newLoginUrls() : [legacyLoginUrl()];
    return await urls.reduce<
      Promise<SemsToken | "rejected" | "unreachable">
    >(
      async (carry, url) => {
        const found = await carry;
        if (found !== "unreachable" && found !== "rejected") return found;
        const attempt = await this.attemptLoginAt(mode, url);
        // Keep a rejection over a later unreachable host — the server has
        // already refused these credentials.
        if (attempt === "unreachable" && found === "rejected") return found;
        return attempt;
      },
      Promise.resolve("unreachable"),
    );
  }

  private async attemptLoginAt(
    mode: LoginMode,
    url: string,
  ): Promise<SemsToken | "rejected" | "unreachable"> {
    try {
      const json = await this.post(
        url,
        await this.loginBody(mode),
        loginHeaders(mode),
      );

      if (String(json.code ?? "") === RATE_LIMIT_CODE) {
        throw new GoodweSemsRateLimitError(RATE_LIMIT_BACKOFF_MS);
      }
      if (!SUCCESS_CODES.has(String(json.code ?? ""))) {
        this.logger.warn(`SEMS ${mode} login rejected (code ${json.code})`);
        this.dbLog.warn(`SEMS ${mode} login rejected`, {
          payload: { mode, code: String(json.code ?? "") },
        });
        return "rejected";
      }

      const envelope = loginEnvelopeSchema.safeParse(json);
      if (!envelope.success || !envelope.data.data?.token) {
        this.logger.warn(`SEMS ${mode} login returned no token field`);
        return "rejected";
      }

      const payload = envelope.data.data;
      const api = resolveLoginApi(envelope.data.api, payload.api, mode);
      if (!api) {
        this.logger.warn(`SEMS ${mode} login returned no api base`);
        return "rejected";
      }
      this.logger.info(`SEMS ${mode} login succeeded — api base ${api}`);
      this.dbLog.info(`SEMS ${mode} login succeeded`, {
        payload: { mode, api },
      });
      return { ...payload, api };
    } catch (error) {
      if (error instanceof GoodweSemsRateLimitError) throw error;
      this.logger.warn(`SEMS ${mode} login unreachable: ${error}`);
      return "unreachable";
    }
  }

  private async loginBody(mode: LoginMode): Promise<Record<string, unknown>> {
    if (mode === "legacy") {
      return { account: this.account, pwd: this.password };
    }
    return {
      account: this.account,
      pwd: await encodeSemsPlusPassword(this.password),
      agreement: 1,
      isChinese: false,
      isLocal: false,
    };
  }

  private apiBase(token: SemsToken, path: string): string {
    const base = resolveApiBase(token, path);
    if (base !== null) return base;
    this.logger.warn(
      `SEMS region unresolvable from api base ${token.api} — falling back to ${LEGACY_API_FALLBACK}`,
    );
    return LEGACY_API_FALLBACK;
  }

  private async post(
    url: string,
    body: Record<string, unknown> | null,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const startedAt = performance.now();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      this.logger.info(
        `SEMS POST ${url} → HTTP ${response.status} in ${elapsedMs}ms`,
      );
      if (!response.ok) {
        throw new GoodweSemsConnectionError(
          `SEMS returned HTTP ${response.status} for ${url}`,
        );
      }
      return await response.json() as Record<string, unknown>;
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      this.logger.warn(
        `SEMS POST ${url} failed after ${elapsedMs}ms: ${error}`,
      );
      if (
        error instanceof GoodweSemsConnectionError ||
        error instanceof GoodweSemsAuthError
      ) {
        throw error;
      }
      throw new GoodweSemsConnectionError(
        `Failed to reach SEMS at ${url}`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
