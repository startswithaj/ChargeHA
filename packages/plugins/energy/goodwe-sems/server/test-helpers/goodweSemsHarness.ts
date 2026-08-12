import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import {
  GoodweSemsClient,
  GoodweSemsRateLimitError,
  type GoodweSemsStationReader,
  type SemsPowerflow,
  type SemsStationDetail,
} from "../GoodweSemsClient.ts";
import { GoodweSemsAdapter } from "../GoodweSemsAdapter.ts";

export const testLogger = new Logger("GoodweSems", "error");
export const testDbLogger = new PluginDbLogger(
  () => Promise.resolve(),
  testLogger,
);

// Mirrors the client's RATE_LIMIT_BACKOFF_MS and the adapter's MAX_STALE_MS.
// Both are internal to their modules; the tests need the same numbers to
// drive FakeTime past each window.
export const RATE_LIMIT_MS = 300_000;
export const MAX_STALE_MS = 15 * 60 * 1000;

export const rateLimitError = (): GoodweSemsRateLimitError =>
  new GoodweSemsRateLimitError(RATE_LIMIT_MS);

// SEMS+ gateway and regional portal bases, as returned by the two logins.
export const GATEWAY_API = "https://au-gateway.semsportal.com/web/sems";
export const REGION_API = "https://au.semsportal.com/api";

export const stationDetailPayload = {
  hasPowerflow: true,
  powerflow: {
    pv: "3000(W)",
    load: "1200(W)",
    grid: "1800(W)",
    gridStatus: "1",
    loadStatus: "-1",
  },
  info: { stationname: "Home" },
  inverter: [{ invert_full: { model_type: "GW10KAU-DT" } }],
};

// ── Fetch mock (GoodweSemsClient transport tests) ────────────────────────────

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockResp {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface FetchMock {
  fetchCalls: FetchCall[];
  // Respond to any URL containing the given substring. Later registrations
  // win over earlier ones for the same substring.
  setPathResponse(pathSubstring: string, resp: MockResp): void;
  // Queue responses for a substring, consumed one per matching request. Once
  // drained, falls back to the `setPathResponse` entry.
  queuePathResponses(pathSubstring: string, resps: MockResp[]): void;
  restore(): void;
}

export const NEW_LOGIN_PATH = "semsplus.goodwe.com";
export const LEGACY_LOGIN_PATH = "www.semsportal.com/api/v3/Common/CrossLogin";
export const STATION_DETAIL_PATH =
  "/v3/PowerStation/GetMonitorDetailByPowerstationId";
export const STATION_LIST_PATH = "/PowerStation/GetPowerStationIdByOwner";

const extractUrl = (input: string | URL | Request): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const buildResponse = (resp: MockResp): Response =>
  new Response(JSON.stringify(resp.json), {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });

// A SEMS envelope with a success code.
export const semsOk = (data: unknown, api?: string): MockResp => ({
  ok: true,
  status: 200,
  json: api === undefined ? { code: "0", data } : { code: "0", api, data },
});

// A SEMS envelope carrying an arbitrary failure code.
export const semsCode = (code: string, data: unknown = null): MockResp => ({
  ok: true,
  status: 200,
  json: { code, data },
});

export const loginOk = (token: string, api?: string): MockResp =>
  semsOk({ token, api }, api);

export const setupFetchMock = (): FetchMock => {
  const fetchCalls: FetchCall[] = [];
  const pathOverrides = new Map<string, MockResp>();
  const pathQueues = new Map<string, MockResp[]>();

  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = extractUrl(input);
    const headers: Record<string, string> = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}),
    );

    fetchCalls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? String(init.body) : undefined,
    });

    const queued = [...pathQueues].find(
      ([path, resps]) => url.includes(path) && resps.length > 0,
    );
    if (queued) {
      const next = queued[1].shift();
      if (next) return Promise.resolve(buildResponse(next));
    }

    const override = [...pathOverrides].find(([path]) => url.includes(path));
    if (override) return Promise.resolve(buildResponse(override[1]));

    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }) as typeof globalThis.fetch;

  return {
    fetchCalls,
    setPathResponse: (path, resp) => {
      pathOverrides.set(path, resp);
    },
    queuePathResponses: (path, resps) => {
      pathQueues.set(path, [...resps]);
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

export const makeClient = (
  overrides: Partial<{ account: string; password: string; logger: Logger }> =
    {},
): GoodweSemsClient =>
  new GoodweSemsClient(
    overrides.account ?? "user@example.com",
    overrides.password ?? "secret123",
    overrides.logger ?? testLogger,
    testDbLogger,
  );

// ── Fake station reader (GoodweSemsAdapter behaviour tests) ──────────────────

export const buildPowerflow = (
  overrides: Partial<SemsPowerflow> = {},
): SemsPowerflow => ({
  // Self-consistent export: pv 3000 = load 1200 + 1800 to the grid. `grid` is
  // an unsigned magnitude and loadStatus -1 is what marks it as export.
  pv: "3000(W)",
  load: "1200(W)",
  grid: "1800(W)",
  gridStatus: "1",
  loadStatus: "-1",
  ...overrides,
});

export const buildStationDetail = (
  overrides: Partial<SemsStationDetail> = {},
): SemsStationDetail => ({
  hasPowerflow: true,
  powerflow: buildPowerflow(),
  stationName: "Test Station",
  inverterModel: "GW10KAU-DT",
  ...overrides,
});

export interface FakeStationClient extends GoodweSemsStationReader {
  // Station ids passed to getStationDetail, one entry per HTTP-equivalent
  // call. Assert on `.length` to prove no request was issued.
  readonly calls: string[];
  readonly clearSessionCalls: () => number;
  // What the next (and every subsequent) call produces.
  setResult(result: SemsStationDetail | Error): void;
}

export const makeFakeClient = (
  initial: SemsStationDetail | Error = buildStationDetail(),
): FakeStationClient => {
  const calls: string[] = [];
  const state: { result: SemsStationDetail | Error; cleared: number } = {
    result: initial,
    cleared: 0,
  };

  return {
    calls,
    clearSessionCalls: () => state.cleared,
    setResult: (result) => {
      state.result = result;
    },
    clearSession: () => {
      state.cleared += 1;
    },
    getStationDetail: (stationId: string) => {
      calls.push(stationId);
      if (state.result instanceof Error) return Promise.reject(state.result);
      return Promise.resolve(state.result);
    },
  };
};

export const makeAdapter = (
  client: GoodweSemsStationReader,
  overrides: Partial<{ stationId: string; logger: Logger }> = {},
): GoodweSemsAdapter =>
  new GoodweSemsAdapter(
    client,
    overrides.stationId ?? "station-1",
    overrides.logger ?? testLogger,
    testDbLogger,
  );
