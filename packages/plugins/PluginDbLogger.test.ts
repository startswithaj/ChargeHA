import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { type PersistLogFn, PluginDbLogger } from "./PluginDbLogger.ts";
import { Logger } from "@chargeha/server/lib/Logger";

describe("PluginDbLogger", () => {
  const testLogger = new Logger("PluginDbLogger", "error");

  const createTestLogger = () => {
    const calls: Array<{
      level: string;
      message: string;
      payload: string | null;
      origin: string | null;
      traceId: string | null;
    }> = [];

    const persist: PersistLogFn = (entry) => {
      calls.push(entry);
      return Promise.resolve();
    };

    return { logger: new PluginDbLogger(persist, testLogger), calls };
  };

  describe("log()", () => {
    it("calls persist with level, message, and null payload/origin", async () => {
      const { logger, calls } = createTestLogger();
      await logger.log("info", "test message");

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        level: "info",
        message: "test message",
        payload: null,
        origin: null,
        traceId: null,
      });
    });

    it("serializes payload to JSON string", async () => {
      const { logger, calls } = createTestLogger();
      await logger.log("info", "with payload", {
        payload: { endpoint: "/api/v1/vehicles", status: 200 },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].payload).toBe(
        JSON.stringify({ endpoint: "/api/v1/vehicles", status: 200 }),
      );
    });

    it("passes origin through", async () => {
      const { logger, calls } = createTestLogger();
      await logger.log("info", "with origin", {
        origin: "poller:charge-state",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].origin).toBe("poller:charge-state");
    });

    it("passes both payload and origin", async () => {
      const { logger, calls } = createTestLogger();
      await logger.log("warn", "slow response", {
        payload: { durationMs: 5000 },
        origin: "connect:init",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        level: "warn",
        message: "slow response",
        payload: JSON.stringify({ durationMs: 5000 }),
        origin: "connect:init",
        traceId: null,
      });
    });
  });

  describe("convenience methods", () => {
    (["info", "warn", "error", "debug"] as const).forEach((level) => {
      it(`${level}() calls persist with that level`, async () => {
        const { logger, calls } = createTestLogger();
        await logger[level](`${level} message`);

        expect(calls).toHaveLength(1);
        expect(calls[0].level).toBe(level);
        expect(calls[0].message).toBe(`${level} message`);
      });
    });
  });

  describe("payload serialization edge cases", () => {
    it("handles empty payload object", async () => {
      const { logger, calls } = createTestLogger();
      await logger.info("empty payload", { payload: {} });

      expect(calls[0].payload).toBe("{}");
    });

    it("handles nested payload objects", async () => {
      const { logger, calls } = createTestLogger();
      await logger.info("nested", {
        payload: { response: { body: { error: "timeout" } } },
      });

      expect(calls[0].payload).toBe(
        JSON.stringify({ response: { body: { error: "timeout" } } }),
      );
    });
  });
});
