import type { EnvoyHttp } from "../EnphaseClient.ts";

/**
 * In-memory `EnvoyHttp` for client/adapter tests. Responses are seeded per
 * path; unseeded paths 404. Every request is recorded for assertions.
 */
export class FakeEnvoyHttp implements EnvoyHttp {
  requests: { path: string; token: string }[] = [];
  private readonly responses = new Map<
    string,
    { status: number; body: string }
  >();

  setJson(path: string, value: unknown, status = 200): this {
    this.responses.set(path, { status, body: JSON.stringify(value) });
    return this;
  }

  setRaw(path: string, body: string, status: number): this {
    this.responses.set(path, { status, body });
    return this;
  }

  get(
    _host: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    this.requests.push({
      path,
      token: (headers.Authorization ?? "").replace("Bearer ", ""),
    });
    return Promise.resolve(
      this.responses.get(path) ?? { status: 404, body: "not found" },
    );
  }
}

/** Build an unsigned JWT whose `exp` lands `msFromNow` past `nowMs`.
 *  Encoded as base64url (no padding, `-`/`_` alphabet) like real JWTs. */
export const makeJwt = (nowMs: number, msFromNow: number): string => {
  const payload = btoa(
    // The `aud` filler forces `-`/`_` in the encoding so base64url conversion is exercised.
    JSON.stringify({
      aud: "ÿþ?>",
      exp: Math.floor((nowMs + msFromNow) / 1000),
    }),
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `header.${payload}.sig`;
};

export interface FakeCloud {
  fetchFn: typeof fetch;
  calls: string[];
}

/**
 * Fake Enphase cloud: answers the Enlighten login and entrez token endpoints.
 * `loginOk: false` fails the login with a 401.
 */
export const makeFakeCloud = (
  { token, loginOk = true }: { token: string; loginOk?: boolean },
): FakeCloud => {
  const calls: string[] = [];
  const fetchFn = ((url: string | URL | Request) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("enlighten.enphaseenergy.com/login")) {
      return Promise.resolve(
        loginOk
          ? new Response(JSON.stringify({ session_id: "sess-1" }))
          : new Response("denied", { status: 401 }),
      );
    }
    if (href.includes("entrez.enphaseenergy.com/tokens")) {
      return Promise.resolve(new Response(token));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  }) as typeof fetch;
  return { fetchFn, calls };
};
