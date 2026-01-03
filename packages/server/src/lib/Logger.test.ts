import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { type Spy, spy } from "@std/testing/mock";
import { createLogger, Logger } from "./Logger.ts";

describe("Logger", () => {
  let logSpy: Spy<unknown, unknown[], void>;
  const originalLog = console.log;

  beforeEach(() => {
    logSpy = spy<unknown, unknown[], void>();
    console.log = logSpy;
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe("level filtering", () => {
    it("logs all levels when set to debug", () => {
      const logger = new Logger("Test", "debug");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      expect(logSpy.calls.length).toBe(4);
    });

    it("hides debug at info level", () => {
      const logger = new Logger("Test", "info");
      logger.debug("should not appear");
      expect(logSpy.calls.length).toBe(0);
      logger.info("visible");
      logger.warn("visible");
      logger.error("visible");
      expect(logSpy.calls.length).toBe(3);
    });

    it("hides debug and info at warn level", () => {
      const logger = new Logger("Test", "warn");
      logger.debug("hidden");
      logger.info("hidden");
      expect(logSpy.calls.length).toBe(0);
      logger.warn("visible");
      logger.error("visible");
      expect(logSpy.calls.length).toBe(2);
    });

    it("only shows error at error level", () => {
      const logger = new Logger("Test", "error");
      logger.debug("hidden");
      logger.info("hidden");
      logger.warn("hidden");
      expect(logSpy.calls.length).toBe(0);
      logger.error("visible");
      expect(logSpy.calls.length).toBe(1);
    });
  });

  describe("output format", () => {
    it("includes timestamp, level, and context prefix", () => {
      const logger = new Logger("EnergyPoller", "debug");
      logger.info("poll complete");
      expect(logSpy.calls.length).toBe(1);
      const firstArg = logSpy.calls[0].args[0] as string;
      // Format: YYYY-MM-DD HH:MM:SS [INFO ] [EnergyPoller]
      expect(firstArg).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[INFO \] \[EnergyPoller\]$/,
      );
      const secondArg = logSpy.calls[0].args[1] as string;
      expect(secondArg).toBe("poll complete");
    });

    it("pads level labels for alignment", () => {
      const logger = new Logger("X", "debug");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      expect(logSpy.calls[0].args[0]).toContain("[DEBUG]");
      expect(logSpy.calls[1].args[0]).toContain("[INFO ]");
      expect(logSpy.calls[2].args[0]).toContain("[WARN ]");
      expect(logSpy.calls[3].args[0]).toContain("[ERROR]");
    });
  });

  describe("extra arguments", () => {
    it("passes extra args to console.log", () => {
      const logger = new Logger("Test", "debug");
      logger.info("count:", 42, { key: "val" });
      expect(logSpy.calls.length).toBe(1);
      expect(logSpy.calls[0].args[1]).toBe("count:");
      expect(logSpy.calls[0].args[2]).toBe(42);
      expect(logSpy.calls[0].args[3]).toEqual({ key: "val" });
    });
  });

  describe("default level", () => {
    it("defaults to info when no level is provided", () => {
      const logger = new Logger("Test");
      logger.debug("hidden");
      expect(logSpy.calls.length).toBe(0);
      logger.info("visible");
      expect(logSpy.calls.length).toBe(1);
    });
  });

  describe("createLogger", () => {
    const originalEnv = Deno.env.get("LOG_LEVEL");

    afterEach(() => {
      if (originalEnv !== undefined) {
        Deno.env.set("LOG_LEVEL", originalEnv);
      } else {
        Deno.env.delete("LOG_LEVEL");
      }
    });

    it("reads LOG_LEVEL from environment", () => {
      Deno.env.set("LOG_LEVEL", "debug");
      const logger = createLogger("Test");
      logger.debug("visible at debug");
      expect(logSpy.calls.length).toBe(1);
    });

    it("defaults to info when LOG_LEVEL is not set", () => {
      Deno.env.delete("LOG_LEVEL");
      const logger = createLogger("Test");
      logger.debug("hidden");
      expect(logSpy.calls.length).toBe(0);
      logger.info("visible");
      expect(logSpy.calls.length).toBe(1);
    });

    it("handles case-insensitive LOG_LEVEL", () => {
      Deno.env.set("LOG_LEVEL", "WARN");
      const logger = createLogger("Test");
      logger.info("hidden");
      expect(logSpy.calls.length).toBe(0);
      logger.warn("visible");
      expect(logSpy.calls.length).toBe(1);
    });

    it("falls back to info for invalid LOG_LEVEL", () => {
      Deno.env.set("LOG_LEVEL", "verbose");
      const logger = createLogger("Test");
      logger.debug("hidden");
      expect(logSpy.calls.length).toBe(0);
      logger.info("visible");
      expect(logSpy.calls.length).toBe(1);
    });
  });
});
