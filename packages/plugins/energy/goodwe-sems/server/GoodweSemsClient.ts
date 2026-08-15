import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { z } from "zod";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { SemsGatewayProbe } from "./SemsGatewayProbe.ts";

function baseOverride(): string | undefined {
  return Deno.env.get("GOODWE_SEMS_BASE_URL")?.replace(/\/$/, "");
}

function newLoginUrls(): string[] {
  const base = baseOverride();
  const path = "/web/sems/sems-user/api/v1/auth/cross-login";
  if (base) return [`${base}${path}`];
  return [
    `https://au-semsplus.goodwe.com${path}`,
    `https://semsplus.goodwe.com${path}`,
  ];
}

function legacyLoginUrl(): string {
  const base = baseOverride();
  return base
    ? `${base}/api/v3/Common/CrossLogin`
    : "https://www.semsportal.com/api/v3/Common/CrossLogin";
}

const NEW_LOGIN_FALLBACK_API = "https://au-gateway.semsportal.com/web/sems";
const LEGACY_API_FALLBACK = "https://au.semsportal.com/api";

const STATION_DETAIL_PATH = "/v3/PowerStation/GetMonitorDetailByPowerstationId";
const STATION_LIST_PATH = "/PowerStation/GetPowerStationIdByOwner";

const BOOTSTRAP_TOKEN = '{"version":"3.1.1","client":"ios","language":"en"}';

const SUCCESS_CODES: ReadonlySet<string> = new Set(["0", "00000"]);
const STALE_TOKEN_CODES: ReadonlySet<string> = new Set(["100002", "C0602"]);
const EMPTY_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const RATE_LIMIT_CODE = "GY0429";
const REQUEST_TIMEOUT_MS = 15_000;

const RATE_LIMIT_BACKOFF_MS = 300_000;

export class GoodweSemsAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "GoodweSemsAuthError";
  }
}

export class GoodweSemsConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "GoodweSemsConnectionError";
  }
}

export class GoodweSemsRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`SEMS rate limited (${RATE_LIMIT_CODE})`);
    this.name = "GoodweSemsRateLimitError";
  }
}

export interface SemsToken {
  readonly api: string;
  readonly region?: string;
  readonly [key: string]: unknown;
}

export interface SemsStationSummary {
  id: string;
  name: string;
}

const numericish = z.union([z.string(), z.number()]).optional();

export const semsPowerflowSchema = z.object({
  pv: numericish,
  load: numericish,
  grid: numericish,
  bettery: numericish,
  betteryStatus: numericish,
  soc: numericish,
  gridStatus: numericish,
  loadStatus: numericish,
}).passthrough();

export type SemsPowerflow = z.infer<typeof semsPowerflowSchema>;

const semsEnvelopeSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  api: z.string().optional(),
  data: z.unknown(),
}).passthrough();

const loginEnvelopeSchema = semsEnvelopeSchema.extend({
  data: z.object({ token: z.string().optional(), api: z.string().optional() })
    .passthrough().optional(),
});

const stationListSchema = z.array(
  z.object({
    id: z.string().optional(),
    powerstation_id: z.string().optional(),
    stationname: z.string().optional(),
  }).passthrough(),
);

const stationDetailSchema = z.object({
  hasPowerflow: z.boolean().optional(),
  powerflow: semsPowerflowSchema.nullish(),
  soc: z.object({ power: numericish }).passthrough().optional(),
  info: z.object({ stationname: z.string().optional() }).passthrough()
    .optional(),
  inverter: z.array(
    z.object({
      invert_full: z.object({ model_type: z.string().optional() })
        .passthrough().optional(),
    }).passthrough(),
  ).optional(),
}).passthrough();

export interface SemsStationDetail {
  hasPowerflow: boolean;
  powerflow: SemsPowerflow | null;
  stationName: string | null;
  inverterModel: string | null;
}

type LoginMode = "new" | "legacy";

function loginHeaders(mode: LoginMode): Record<string, string> {
  if (mode === "legacy") {
    return {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "token": BOOTSTRAP_TOKEN,
    };
  }
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, */*;q=0.5",
  };
}

function resolveLoginApi(
  envelopeApi: string | undefined,
  payloadApi: string | undefined,
  mode: LoginMode,
): string | null {
  if (envelopeApi) return envelopeApi;
  if (payloadApi) return payloadApi;
  if (mode === "new") return NEW_LOGIN_FALLBACK_API;
  return null;
}

async function encodeSemsPlusPassword(password: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(password),
  );
  return btoa(encodeHex(new Uint8Array(digest)));
}

function isEmptyData(data: unknown): boolean {
  if (data === null || data === undefined || data === "") return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") return Object.keys(data).length === 0;
  return false;
}

function validRegion(region: unknown): string | null {
  if (typeof region !== "string") return null;
  const trimmed = region.trim().toLowerCase();
  return /^[a-z]{2,4}$/.test(trimmed) ? trimmed : null;
}

function extractRegion(base: string): string | null {
  const host = base.split("//").at(-1)?.split("/")[0] ?? "";
  if (host.endsWith("-gateway.semsportal.com")) {
    return host.replace("-gateway.semsportal.com", "") || null;
  }
  if (host.endsWith(".semsportal.com")) return host.split(".")[0] || null;
  return null;
}

export interface GoodweSemsStationReader {
  clearSession(): void;
  getStationDetail(stationId: string): Promise<SemsStationDetail>;
  probeGatewayFlow?(
    stationId: string,
    legacy: SemsPowerflow | null,
  ): Promise<void>;
}

export class GoodweSemsClient implements GoodweSemsStationReader {
  private token: SemsToken | null = null;
  private preferredMode: LoginMode | null = null;
  private readonly gatewayProbe: SemsGatewayProbe;
  private loginPromise: Promise<void> | null = null;
  private lastEmptyRetryAtMs = 0;

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

    const token = await modes.reduce<Promise<SemsToken | null>>(
      async (carry, mode) => {
        const found = await carry;
        if (found) return found;
        const attempt = await this.attemptLogin(mode);
        if (attempt) this.preferredMode = mode;
        return attempt;
      },
      Promise.resolve(null),
    );

    if (!token) {
      throw new GoodweSemsAuthError(
        "SEMS login rejected — check the account email and password",
      );
    }
    this.token = token;
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
    const parsed = stationDetailSchema.safeParse(
      await this.call(STATION_DETAIL_PATH, { powerStationId: stationId }),
    );
    if (!parsed.success) {
      throw new GoodweSemsConnectionError(
        "SEMS returned a station payload in an unrecognised shape",
      );
    }
    const data = parsed.data;
    const powerflow = data.hasPowerflow === true
      ? data.powerflow ?? null
      : null;
    if (
      powerflow && powerflow.soc === undefined && data.soc?.power !== undefined
    ) {
      powerflow.soc = data.soc.power;
    }
    return {
      hasPowerflow: data.hasPowerflow === true,
      powerflow,
      stationName: data.info?.stationname ?? null,
      inverterModel: data.inverter?.[0]?.invert_full?.model_type ?? null,
    };
  }

  private async call(
    path: string,
    body: Record<string, unknown> | null,
    isRetry = false,
  ): Promise<unknown> {
    await this.ensureLoggedIn();
    const token = this.token;
    if (!token) throw new GoodweSemsAuthError("SEMS login produced no token");

    const url = this.resolveApiBase(token, path) + path;
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

  private async attemptLogin(mode: LoginMode): Promise<SemsToken | null> {
    const urls = mode === "new" ? newLoginUrls() : [legacyLoginUrl()];
    return await urls.reduce<Promise<SemsToken | null>>(
      async (carry, url) => (await carry) ?? this.attemptLoginAt(mode, url),
      Promise.resolve(null),
    );
  }

  private async attemptLoginAt(
    mode: LoginMode,
    url: string,
  ): Promise<SemsToken | null> {
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
        return null;
      }

      const envelope = loginEnvelopeSchema.safeParse(json);
      if (!envelope.success || !envelope.data.data?.token) {
        this.logger.warn(`SEMS ${mode} login returned no token field`);
        return null;
      }

      const payload = envelope.data.data;
      const api = resolveLoginApi(envelope.data.api, payload.api, mode);
      if (!api) {
        this.logger.warn(`SEMS ${mode} login returned no api base`);
        return null;
      }
      this.logger.info(`SEMS ${mode} login succeeded — api base ${api}`);
      this.dbLog.info(`SEMS ${mode} login succeeded`, {
        payload: { mode, api },
      });
      return { ...payload, api };
    } catch (error) {
      if (error instanceof GoodweSemsRateLimitError) throw error;
      this.logger.warn(`SEMS ${mode} login unreachable: ${error}`);
      return null;
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

  private resolveApiBase(token: SemsToken, path: string): string {
    const override = baseOverride();
    if (override) return `${override}/api`;

    const base = token.api.replace(/\/$/, "");
    const isStationRoute = path.startsWith("/PowerStation") ||
      path.startsWith("/v3/PowerStation");
    if (!isStationRoute) return base;
    const host = base.split("//").at(-1)?.split("/")[0] ?? "";
    const isSemsPlusHost = host.endsWith("-gateway.semsportal.com") ||
      host.endsWith("semsplus.goodwe.com");
    if (!isSemsPlusHost) return base;

    const region = validRegion(token.region) ?? extractRegion(base);
    if (region) return `https://${region}.semsportal.com/api`;
    this.logger.warn(
      `SEMS region unresolvable from api base ${base} — falling back to ${LEGACY_API_FALLBACK}`,
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
