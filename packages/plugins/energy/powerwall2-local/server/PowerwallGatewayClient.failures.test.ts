import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  PowerwallGatewayClient,
  PowerwallGatewayConnectionError,
} from "./PowerwallGatewayClient.ts";
import { FakePowerwallHttp, response } from "./test-helpers/powerwallHttp.ts";

describe("PowerwallGatewayClient failures and recovery", () => {
  const login = "/api/login/Basic";
  const path = "/api/meters/aggregates";
  const client = (http: FakePowerwallHttp) =>
    new PowerwallGatewayClient(
      "192.0.2.10",
      "owner@example.com",
      "test-password",
      http,
    );

  it("stops after one reauthentication for repeated unauthorized responses", async () => {
    const http = new FakePowerwallHttp().queue(
      login,
      response(200, { token: "one" }),
      response(200, { token: "two" }),
    ).queue(path, response(401, {}), response(403, {}));

    await expect(client(http).getJson(path)).rejects.toThrow(
      "rejected the configured customer credentials",
    );
    expect(http.requests).toHaveLength(4);
  });

  it("rejects a login without a session token", async () => {
    const http = new FakePowerwallHttp().queue(login, response(200, {}));

    await expect(client(http).getJson(path)).rejects.toThrow(
      "no session token",
    );
    expect(http.requests).toHaveLength(1);
  });

  it("does not retain a malformed login response in the error chain", async () => {
    const http = new FakePowerwallHttp().queue(
      login,
      response(200, "test-password:not-json"),
    );
    const error = await client(http).getJson(path).catch((error: Error) =>
      error
    );

    expect(error).toBeInstanceOf(PowerwallGatewayConnectionError);
    expect(String(error)).not.toContain("test-password");
    expect((error as Error).cause).toBeUndefined();
  });

  it("rejects malformed and non-object telemetry", async () => {
    const http = new FakePowerwallHttp().queue(
      login,
      response(200, { token: "one" }),
    ).queue(path, response(200, "not-json"), response(200, []));
    const api = client(http);

    await expect(api.getJson(path)).rejects.toThrow("invalid JSON");
    await expect(api.getJson(path)).rejects.toThrow("invalid JSON");
  });

  it("recovers after a failed login request without caching its rejected promise", async () => {
    const http = new FakePowerwallHttp().queue(
      login,
      new Error("network unavailable"),
      response(200, { token: "recovered" }),
    ).queue(path, response(200, { ok: true }));
    const api = client(http);

    await expect(api.getJson(path)).rejects.toThrow("network unavailable");
    await expect(api.getJson(path)).resolves.toEqual({ ok: true });
  });

  it("does not retry server failures or include their response body", async () => {
    const http = new FakePowerwallHttp().queue(
      login,
      response(200, { token: "one" }),
    ).queue(path, response(503, "private-body"));

    await expect(client(http).getJson(path)).rejects.toThrow("HTTP 503");
    expect(http.requests).toHaveLength(2);
  });

  it("clears the session before reconnecting", async () => {
    const http = new FakePowerwallHttp().queue(
      login,
      response(200, { token: "one" }),
      response(200, { token: "two" }),
    ).queue(path, response(200, {}), response(200, {}));
    const api = client(http);

    await api.getJson(path);
    api.clearSession();
    await api.getJson(path);

    expect(http.requests.at(-1)?.headers.Cookie).toBe("AuthCookie=two");
  });
});
