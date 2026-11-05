import { describe, it } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import { expect } from "@std/expect";
import { makeNodeHttpsPowerwallHttp } from "./PowerwallGatewayClient.ts";
import { httpsHarness } from "./test-helpers/httpsHarness.ts";

describe("Powerwall HTTPS transport", () => {
  it("uses scoped self-signed TLS and combines response chunks", async () => {
    const harness = httpsHarness("success");
    try {
      const response = await makeNodeHttpsPowerwallHttp().request(
        "192.0.2.10",
        "/test",
        "POST",
        { "Content-Type": "application/json" },
        "{}",
      );

      expect(response).toEqual({
        status: 200,
        body: '{"ok":true}',
        setCookies: ["AuthCookie=test; Path=/"],
      });
      expect(harness.options[0]).toMatchObject({
        hostname: "192.0.2.10",
        port: 443,
        rejectUnauthorized: false,
        timeout: 10_000,
      });
      expect(harness.writes).toEqual(["{}"]);
      expect(harness.options[0].agent).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it("destroys timed-out requests and rejects with a bounded error", async () => {
    const harness = httpsHarness("timeout");
    try {
      await expect(
        makeNodeHttpsPowerwallHttp(20).request(
          "192.0.2.10",
          "/test",
          "GET",
          {},
        ),
      ).rejects.toThrow("timed out after 20ms");

      expect(harness.state.destroyed).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it("rejects connection errors", async () => {
    const harness = httpsHarness("error");
    try {
      await expect(
        makeNodeHttpsPowerwallHttp().request("192.0.2.10", "/test", "GET", {}),
      ).rejects.toThrow("transport connection failed");
    } finally {
      harness.restore();
    }
  });

  it("rejects an interrupted response instead of leaving a pending promise", async () => {
    const harness = httpsHarness("interrupted");
    try {
      await expect(
        makeNodeHttpsPowerwallHttp().request("192.0.2.10", "/test", "GET", {}),
      ).rejects.toThrow("response interrupted");
    } finally {
      harness.restore();
    }
  });

  it("aborts a request and clears its wall-clock timer", async () => {
    const harness = httpsHarness("hang");
    const controller = new AbortController();
    try {
      const result = makeNodeHttpsPowerwallHttp().request(
        "192.0.2.10",
        "/test",
        "GET",
        {},
        undefined,
        controller.signal,
      );
      const rejected = expect(result).rejects.toThrow("cancelled");

      controller.abort();
      await rejected;

      expect(harness.state.destroyed).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it("times out a stalled request even when no socket timeout event arrives", async () => {
    const time = new FakeTime();
    const harness = httpsHarness("hang");
    try {
      const result = makeNodeHttpsPowerwallHttp(100).request(
        "192.0.2.10",
        "/test",
        "GET",
        {},
      );
      const rejected = expect(result).rejects.toThrow("100ms");

      time.tick(100);
      await rejected;

      expect(harness.state.destroyed).toBe(true);
    } finally {
      harness.restore();
      time.restore();
    }
  });

  it("ignores late request and response events while the next request is active", async () => {
    const time = new FakeTime();
    const harness = httpsHarness("hang");
    const http = makeNodeHttpsPowerwallHttp();
    const read = () => http.request("192.0.2.10", "/test", "GET", {});
    try {
      const failed = expect(read()).rejects.toThrow("10000ms");
      const previous = harness.exchanges[0];

      time.tick(10_000);
      await failed;

      const replacement = read();
      previous.request.emit("error", new Error("late transport error"));
      previous.request.emit("timeout");
      previous.reply();
      previous.response.emit("aborted");
      previous.response.emit("end");

      expect(previous.destroyed).toEqual({ requests: 1, responses: 1 });
      expect(harness.exchanges[1].destroyed.requests).toBe(0);

      harness.exchanges[1].finish();

      expect((await replacement).status).toBe(200);

      const next = read();

      harness.exchanges[2].finish();

      expect((await next).status).toBe(200);
      expect(harness.exchanges).toHaveLength(3);
    } finally {
      http.close?.();
      harness.restore();
      time.restore();
    }
  });

  it("issues nothing on pre-abort and cancels pending requests on close", async () => {
    const time = new FakeTime();
    const harness = httpsHarness("hang");
    const http = makeNodeHttpsPowerwallHttp();
    const controller = new AbortController();

    controller.abort();
    try {
      http.close?.();

      await expect(
        http.request(
          "192.0.2.10",
          "/test",
          "GET",
          {},
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow("cancelled");

      expect(harness.options).toHaveLength(0);

      const active = expect(http.request("192.0.2.10", "/active", "GET", {}))
        .rejects.toThrow("cancelled");
      const other = expect(http.request("192.0.2.10", "/other", "GET", {}))
        .rejects.toThrow("cancelled");

      http.close?.();
      http.close?.();
      await Promise.all([active, other]);

      harness.exchanges.forEach((exchange) => {
        exchange.request.emit("timeout");
        exchange.reply();

        expect(exchange.destroyed).toEqual({ requests: 1, responses: 1 });
      });

      time.tick(20_000);

      expect(harness.options).toHaveLength(2);

      const reused = http.request("192.0.2.10", "/reused", "GET", {});

      harness.exchanges[2].finish();

      expect((await reused).status).toBe(200);
    } finally {
      http.close?.();
      harness.restore();
      time.restore();
    }
  });
});
