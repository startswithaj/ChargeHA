import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { PowerwallGatewayClient } from "./PowerwallGatewayClient.ts";
import { FakePowerwallHttp, response } from "./test-helpers/powerwallHttp.ts";

describe("Powerwall rate-limit cooldown", () => {
  let time: FakeTime;
  let http: FakePowerwallHttp;
  let client: PowerwallGatewayClient;
  beforeEach(() => {
    time = new FakeTime(Date.parse("2026-10-14T01:00:00Z"));
    http = new FakePowerwallHttp().queue(
      "/api/login/Basic",
      response(200, { token: "test" }),
    );
    client = new PowerwallGatewayClient("192.0.2.10", "", "test", http);
  });
  afterEach(() => time.restore());

  it("uses a five-minute fallback on 429 and blocks all endpoints without re-login", async () => {
    http.queue("/meters", response(429, {}), response(200, { ok: true }));

    await expect(client.getJson("/meters")).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 300_000,
    });

    time.tick(299_999);

    await expect(client.getJson("/soc")).rejects.toThrow("cooling down");
    await expect(client.getStatus()).rejects.toThrow("cooling down");
    expect(http.requests).toHaveLength(2);

    time.tick(1);

    expect(await client.getJson("/meters")).toEqual({ ok: true });
    expect(http.requests.filter((request) => request.method === "POST"))
      .toHaveLength(1);
  });

  it("honours numeric Retry-After and caps unreasonable values", async () => {
    http.queue("/meters", { ...response(429, {}), retryAfter: "600" }, {
      ...response(429, {}),
      retryAfter: "999999999",
    });

    await expect(client.getJson("/meters")).rejects.toMatchObject({
      retryAfterMs: 600_000,
    });

    time.tick(600_000);

    await expect(client.getJson("/meters")).rejects.toMatchObject({
      retryAfterMs: 3_600_000,
    });
  });

  it("honours HTTP-date Retry-After on 503", async () => {
    http.queue("/meters", {
      ...response(503, {}),
      retryAfter: new Date(Date.now() + 120_000).toUTCString(),
    });

    await expect(client.getJson("/meters")).rejects.toMatchObject({
      status: 503,
      retryAfterMs: 120_000,
    });
  });

  it("also cools down when the login endpoint rate limits", async () => {
    http.queue("/api/login/Basic", response(429, {}));

    await expect(client.getJson("/meters")).rejects.toMatchObject({
      status: 429,
    });
    await expect(client.getJson("/meters")).rejects.toThrow("cooling down");
    expect(http.requests).toHaveLength(1);
  });

  it("rejects an already cancelled operation without issuing a request", async () => {
    const controller = new AbortController();

    controller.abort(new Error("cancelled"));

    await expect(client.getJson("/meters", controller.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(http.requests).toHaveLength(0);
  });
});
