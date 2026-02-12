import { FroniusCloudAdapter } from "../FroniusCloudAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";

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
  /** Override the POST /iam/jwt login response. */
  setLoginResponse(resp: MockResp): void;
  /** Override the PATCH /iam/jwt/{refreshToken} refresh response. */
  setRefreshResponse(resp: MockResp): void;
  /** Override the response for any URL containing the given path substring. */
  setPathResponse(pathSubstring: string, resp: MockResp): void;
  /** Override the default token expiration returned by login (default: +1h). */
  setLoginTokenExpiresIn(ms: number): void;
  restore(): void;
}

export const testLogger = new Logger("FroniusCloud", "error");

const ACCESS_TOKEN = "test-access-token";
const REFRESH_TOKEN = "test-refresh-token";
const REFRESHED_ACCESS_TOKEN = "refreshed-access-token";
const REFRESHED_REFRESH_TOKEN = "refreshed-refresh-token";

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

export const setupFetchMock = (): FetchMock => {
  const fetchCalls: FetchCall[] = [];
  const pathOverrides = new Map<string, MockResp>();
  const state: {
    loginResponse?: MockResp;
    refreshResponse?: MockResp;
    loginTokenExpiresInMs: number;
  } = { loginTokenExpiresInMs: 3600_000 };

  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
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

    const isLogin = url.includes("/iam/jwt") &&
      !url.match(/\/iam\/jwt\/[^/]+$/);
    const isRefresh = !!url.match(/\/iam\/jwt\/[^/]+$/);

    if (isLogin) {
      const defaultLogin: MockResp = {
        ok: true,
        status: 200,
        json: {
          jwtToken: ACCESS_TOKEN,
          refreshToken: REFRESH_TOKEN,
          jwtTokenExpiration: new Date(
            Date.now() + state.loginTokenExpiresInMs,
          ).toISOString(),
        },
      };
      return Promise.resolve(
        buildResponse(state.loginResponse ?? defaultLogin),
      );
    }

    if (isRefresh) {
      const defaultRefresh: MockResp = {
        ok: true,
        status: 200,
        json: {
          jwtToken: REFRESHED_ACCESS_TOKEN,
          refreshToken: REFRESHED_REFRESH_TOKEN,
          jwtTokenExpiration: new Date(Date.now() + 3600_000).toISOString(),
        },
      };
      return Promise.resolve(
        buildResponse(state.refreshResponse ?? defaultRefresh),
      );
    }

    const override = [...pathOverrides].find(([path]) => url.includes(path));
    if (override) return Promise.resolve(buildResponse(override[1]));

    if (url.includes("/pvsystems/")) {
      return Promise.resolve(
        buildResponse({
          ok: true,
          status: 200,
          json: { pvSystemId: "test-system-id", name: "My PV System" },
        }),
      );
    }

    return Promise.resolve(
      new Response("Not Found", { status: 404 }),
    );
  }) as typeof globalThis.fetch;

  return {
    fetchCalls,
    setLoginResponse: (resp) => {
      state.loginResponse = resp;
    },
    setRefreshResponse: (resp) => {
      state.refreshResponse = resp;
    },
    setPathResponse: (path, resp) => {
      pathOverrides.set(path, resp);
    },
    setLoginTokenExpiresIn: (ms) => {
      state.loginTokenExpiresInMs = ms;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

export const makeAdapter = (
  overrides: Partial<{
    email: string;
    password: string;
    pvSystemId: string;
    logger: Logger;
  }> = {},
): FroniusCloudAdapter =>
  new FroniusCloudAdapter(
    overrides.email ?? "user@example.com",
    overrides.password ?? "secret123",
    overrides.pvSystemId ?? "pv-system-1",
    overrides.logger ?? testLogger,
  );

export const flowdataResponse = (
  channels: Array<{
    channelName: string;
    channelType: string;
    value: number | null;
    unit: string;
  }>,
  isOnline = true,
): MockResp => ({
  ok: true,
  status: 200,
  json: { status: { isOnline }, data: { channels } },
});
