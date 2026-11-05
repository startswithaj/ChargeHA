import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  PowerwallGatewayAuthError,
  PowerwallGatewayClient,
} from "./PowerwallGatewayClient.ts";

import { FakePowerwallHttp, response } from "./test-helpers/powerwallHttp.ts";

describe("PowerwallGatewayClient", () => {
  const host = "192.0.2.10";
  const loginPath = "/api/login/Basic";
  const dataPath = "/api/meters/aggregates";
  const password = "local-secret";
  let http: FakePowerwallHttp;

  beforeEach(() => {
    http = new FakePowerwallHttp();
  });

  const makeClient = () =>
    new PowerwallGatewayClient(host, "owner@example.com", password, http);

  it("logs in once and sends only the AuthCookie to protected endpoints", async () => {
    http
      .queue(
        loginPath,
        response(200, { token: "body-token" }, [
          "AuthCookie=cookie-token; Path=/; HttpOnly",
        ]),
      )
      .queue(dataPath, response(200, { site: {} }));

    await expect(makeClient().getJson(dataPath)).resolves.toEqual({ site: {} });

    expect(http.requests.map((request) => request.path)).toEqual([
      loginPath,
      dataPath,
    ]);
    expect(http.requests[1].headers.Cookie).toBe("AuthCookie=cookie-token");
    expect(http.requests[0].body).toContain(password);
    expect(http.requests[1].body).toBeUndefined();
  });

  it("falls back to the JSON token when no Set-Cookie header is present", async () => {
    http
      .queue(loginPath, response(200, { token: "json-token" }))
      .queue(dataPath, response(200, { ok: true }));

    await makeClient().getJson(dataPath);

    expect(http.requests[1].headers.Cookie).toBe("AuthCookie=json-token");
  });

  it("reauthenticates once when the Gateway expires a session", async () => {
    http
      .queue(
        loginPath,
        response(200, { token: "first" }),
        response(200, { token: "second" }),
      )
      .queue(
        dataPath,
        response(403, { error: "forbidden" }),
        response(200, { ok: true }),
      );

    await expect(makeClient().getJson(dataPath)).resolves.toEqual({ ok: true });

    expect(http.requests.filter((request) => request.path === loginPath))
      .toHaveLength(2);
    expect(http.requests.at(-1)?.headers.Cookie).toBe("AuthCookie=second");
  });

  it("shares one login between concurrent protected requests", async () => {
    http
      .queue(loginPath, response(200, { token: "shared" }))
      .queue("/one", response(200, { value: 1 }))
      .queue("/two", response(200, { value: 2 }));
    const client = makeClient();

    const values = await Promise.all([
      client.getJson("/one"),
      client.getJson("/two"),
    ]);

    expect(values).toEqual([{ value: 1 }, { value: 2 }]);
    expect(http.requests.filter((request) => request.path === loginPath))
      .toHaveLength(1);
  });

  it("reads the public status endpoint without logging in", async () => {
    http.queue("/api/status", response(200, { device_type: "teg" }));

    await expect(makeClient().getStatus()).resolves.toEqual({
      device_type: "teg",
    });

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].path).toBe("/api/status");
  });

  it("does not include the configured password in authentication errors", async () => {
    http.queue(loginPath, response(401, { error: password }));

    const error: unknown = await makeClient().getJson(dataPath).catch((err) =>
      err
    );

    expect(error).toBeInstanceOf(PowerwallGatewayAuthError);
    expect((error as Error).message).not.toContain(password);
  });
});
