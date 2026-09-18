import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { type PersistLogFn, PluginDbLogger } from "./PluginDbLogger.ts";
import { Logger } from "./Logger.ts";

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

  describe("stdout mirror", () => {
    it("redacts location and VINs on stdout but persists the full payload", async () => {
      const stdout: string[] = [];
      const capturing = new (class extends Logger {
        override info(message: string, ...args: unknown[]): void {
          stdout.push([message, ...args].join(" "));
        }
      })("PluginDbLogger", "info");
      const calls: Array<{ payload: string | null }> = [];
      const logger = new PluginDbLogger((entry) => {
        calls.push(entry);
        return Promise.resolve();
      }, capturing);

      const vin = "5YJ3E1EA7KF317000";
      const payload = {
        vin,
        endpoint: `/api/1/vehicles/${vin}/vehicle_data`,
        response: { drive_state: { latitude: -33.8, longitude: 151.2 } },
      };
      await logger.info("GET vehicle_data", { payload });

      expect(calls[0].payload).toBe(JSON.stringify(payload));
      expect(stdout).toHaveLength(1);
      expect(stdout[0]).not.toContain(vin);
      expect(stdout[0]).not.toContain("-33.8");
      expect(stdout[0]).toContain("…317000");
      expect(stdout[0]).toContain("[redacted]");
    });
  });
});
