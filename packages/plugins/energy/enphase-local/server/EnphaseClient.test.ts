import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { EnphaseAuthError, EnphaseClient } from "./EnphaseClient.ts";
import {
  FakeEnvoyHttp,
  makeFakeCloud,
  makeJwt,
} from "./test-helpers/enphaseHttpHarness.ts";

describe("EnphaseClient", () => {
  const logger = new Logger("EnphaseTest", "error");
  const NOW = 1_800_000_000_000;
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  let http: FakeEnvoyHttp;
  let persisted: string[];

  beforeEach(() => {
    http = new FakeEnvoyHttp().setJson("/info", { ok: true });
    persisted = [];
  });

  const makeClient = (
    auth: {
      email?: string;
      password?: string;
      manualToken?: string;
      cachedToken?: string;
    },
    fetchFn: typeof fetch = makeFakeCloud({ token: "unused" }).fetchFn,
  ) =>
    new EnphaseClient(
      "10.0.0.7",
      "SN1",
      {
        email: auth.email ?? "",
        password: auth.password ?? "",
        manualToken: auth.manualToken ?? "",
        cachedToken: auth.cachedToken ?? "",
      },
      (t) => {
        persisted.push(t);
        return Promise.resolve();
      },
      logger,
      http,
      fetchFn,
      () => NOW,
    );

  it("uses a manual token as-is without any cloud calls", async () => {
    const cloud = makeFakeCloud({ token: "should-not-be-fetched" });
    const client = makeClient({ manualToken: "pasted-token" }, cloud.fetchFn);

    await client.getJson("/info");

    expect(http.requests[0].token).toBe("pasted-token");
    expect(cloud.calls).toEqual([]);
  });

  it("reuses a cached token that is far from expiry", async () => {
    const cached = makeJwt(NOW, YEAR_MS);
    const cloud = makeFakeCloud({ token: "fresh" });
    const client = makeClient(
      { email: "a@b.c", password: "pw", cachedToken: cached },
      cloud.fetchFn,
    );

    await client.getJson("/info");

    expect(http.requests[0].token).toBe(cached);
    expect(cloud.calls).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("fetches and persists a fresh token when the cached one nears expiry", async () => {
    const fresh = makeJwt(NOW, YEAR_MS);
    const cloud = makeFakeCloud({ token: fresh });
    const client = makeClient(
      {
        email: "a@b.c",
        password: "pw",
        cachedToken: makeJwt(NOW, DAY_MS), // inside the 7-day renew margin
      },
      cloud.fetchFn,
    );

    await client.getJson("/info");

    expect(http.requests[0].token).toBe(fresh);
    expect(persisted).toEqual([fresh]);
    expect(cloud.calls).toHaveLength(2); // login + entrez
  });

  it("refreshes once and retries when the Envoy returns 401", async () => {
    const fresh = makeJwt(NOW, YEAR_MS);
    const cached = makeJwt(NOW, YEAR_MS / 2);
    http.setRaw("/data", "denied", 401);
    const cloud = makeFakeCloud({ token: fresh });
    const client = makeClient(
      { email: "a@b.c", password: "pw", cachedToken: cached },
      cloud.fetchFn,
    );

    await expect(client.getJson("/data")).rejects.toThrow("HTTP 401");

    expect(http.requests.map((r) => r.token)).toEqual([cached, fresh]);
    expect(persisted).toEqual([fresh]);
  });

  it("pauses cloud refreshes after a freshly fetched token is also rejected", async () => {
    const fresh = makeJwt(NOW, YEAR_MS);
    http.setRaw("/data", "denied", 401);
    const cloud = makeFakeCloud({ token: fresh });
    const client = makeClient(
      { email: "a@b.c", password: "pw", cachedToken: makeJwt(NOW, YEAR_MS) },
      cloud.fetchFn,
    );

    await expect(client.getJson("/data")).rejects.toThrow("HTTP 401");
    expect(cloud.calls).toHaveLength(2); // login + entrez

    await expect(client.getJson("/data")).rejects.toThrow(
      EnphaseAuthError,
    );
    expect(cloud.calls).toHaveLength(2); // no further cloud logins
  });

  it("throws EnphaseAuthError on bad credentials", async () => {
    const cloud = makeFakeCloud({ token: "x", loginOk: false });
    const client = makeClient(
      { email: "a@b.c", password: "wrong" },
      cloud.fetchFn,
    );

    await expect(client.getJson("/info")).rejects.toThrow(EnphaseAuthError);
    await expect(client.getJson("/info")).rejects.toThrow(
      "check email/password",
    );
  });

  it("throws EnphaseAuthError when a manual token is rejected", async () => {
    http.setRaw("/data", "denied", 401);
    const client = makeClient({ manualToken: "stale" });

    await expect(client.getJson("/data")).rejects.toThrow(
      "Generate a new token",
    );
  });

  it("throws when no token and no credentials are configured", async () => {
    const client = makeClient({});

    await expect(client.getJson("/info")).rejects.toThrow(
      "no Enphase credentials",
    );
  });
});
