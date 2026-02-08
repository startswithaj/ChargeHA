import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { resetDatabase } from "./db-cli.ts";
import { withEnv } from "../test-helpers/withEnv.ts";

describe("db CLI", () => {
  const stubDenoExit = (): {
    getExitCode: () => number | undefined;
    restore: () => void;
  } => {
    const originalExit = Deno.exit;
    let exitCode: number | undefined;
    Object.defineProperty(Deno, "exit", {
      value: (code?: number) => {
        exitCode = code;
        throw new Error("EXIT");
      },
      writable: true,
      configurable: true,
    });
    return {
      getExitCode: () => exitCode,
      restore: () => {
        Object.defineProperty(Deno, "exit", {
          value: originalExit,
          writable: true,
          configurable: true,
        });
      },
    };
  };

  describe("reset", () => {
    it("refuses when CHARGEHA_ENV=production", async () => {
      const stub = stubDenoExit();
      try {
        await withEnv("CHARGEHA_ENV", "production", async () => {
          try {
            await resetDatabase(":memory:", { yes: true });
          } catch (e) {
            expect((e as Error).message).toBe("EXIT");
          }
          expect(stub.getExitCode()).toBe(1);
        });
      } finally {
        stub.restore();
      }
    });

    it("refuses when NODE_ENV=production", async () => {
      const stub = stubDenoExit();
      try {
        await withEnv("NODE_ENV", "production", async () => {
          try {
            await resetDatabase(":memory:", { yes: true });
          } catch (e) {
            expect((e as Error).message).toBe("EXIT");
          }
          expect(stub.getExitCode()).toBe(1);
        });
      } finally {
        stub.restore();
      }
    });
  });
});
