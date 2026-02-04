import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TRPCError } from "@trpc/server";
import { createCallerFactory, publicProcedure, router } from "./trpc.ts";
import type { TrpcContext } from "./trpc.ts";
import { AuthError } from "../services/AuthService.ts";
import { GeocodeError } from "../services/GeocodeService.ts";

describe("tRPC error middleware", () => {
  /**
   * A tiny router that lets each test inject whatever error it wants to throw.
   * The procedure re-throws `ctx.errorToThrow` (set per test) so the error
   * middleware on publicProcedure can map it.
   */
  const testRouter = router({
    throwError: publicProcedure.mutation(({ ctx }) => {
      const errorToThrow = (ctx as TrpcContext & { errorToThrow: unknown })
        .errorToThrow;
      if (errorToThrow) throw errorToThrow;
      return { ok: true };
    }),
  });

  const createCaller = createCallerFactory(testRouter);

  // Build a minimal TrpcContext stand-in. Only `errorToThrow` is exposed;
  // any other field access fails loudly so middleware bugs that touch real
  // context fields surface as a clear test failure rather than `undefined`.
  const makeCtx = (errorToThrow?: unknown): TrpcContext =>
    new Proxy({}, {
      get(_target, prop) {
        if (prop === "errorToThrow") return errorToThrow;
        // Allow standard JS protocol probes (then/Symbol.*) to return undefined.
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") return undefined;
        throw new Error(
          `TrpcContext.${String(prop)} accessed but not stubbed`,
        );
      },
    }) as TrpcContext;

  it("maps AuthError with UNAUTHORIZED code to TRPCError UNAUTHORIZED", async () => {
    const caller = createCaller(
      makeCtx(new AuthError("Invalid credentials", "UNAUTHORIZED")),
    );

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("UNAUTHORIZED");
      expect((err as TRPCError).message).toBe("Invalid credentials");
    }
  });

  it("maps AuthError with BAD_REQUEST code to TRPCError BAD_REQUEST", async () => {
    const caller = createCaller(
      makeCtx(new AuthError("Password too short", "BAD_REQUEST")),
    );

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
      expect((err as TRPCError).message).toBe("Password too short");
    }
  });

  it("maps AuthError with TOO_MANY_REQUESTS code to TRPCError TOO_MANY_REQUESTS", async () => {
    const caller = createCaller(
      makeCtx(
        new AuthError(
          JSON.stringify({ retryAfter: 60 }),
          "TOO_MANY_REQUESTS",
        ),
      ),
    );

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("TOO_MANY_REQUESTS");
      const parsed = JSON.parse((err as TRPCError).message);
      expect(parsed.retryAfter).toBe(60);
    }
  });

  it("maps plain Error('Invalid credentials') to TRPCError UNAUTHORIZED with 'invalid_credentials' message", async () => {
    const caller = createCaller(
      makeCtx(new Error("Invalid credentials")),
    );

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("UNAUTHORIZED");
      expect((err as TRPCError).message).toBe("invalid_credentials");
    }
  });

  it("maps GeocodeError with NOT_FOUND code to TRPCError NOT_FOUND", async () => {
    const caller = createCaller(
      makeCtx(
        new GeocodeError("No results found for that address", "NOT_FOUND"),
      ),
    );

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
      expect((err as TRPCError).message).toBe(
        "No results found for that address",
      );
    }
  });

  it("maps GeocodeError with BAD_GATEWAY code to TRPCError BAD_GATEWAY", async () => {
    const caller = createCaller(
      makeCtx(
        new GeocodeError("Geocoding service unavailable", "BAD_GATEWAY"),
      ),
    );

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_GATEWAY");
      expect((err as TRPCError).message).toBe("Geocoding service unavailable");
    }
  });

  it("lets TRPCErrors pass through unchanged", async () => {
    const original = new TRPCError({
      code: "NOT_FOUND",
      message: "Resource not found",
    });
    const caller = createCaller(makeCtx(original));

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
      expect((err as TRPCError).message).toBe("Resource not found");
    }
  });

  it("wraps unknown errors in INTERNAL_SERVER_ERROR", async () => {
    const caller = createCaller(
      makeCtx(new Error("Something unexpected")),
    );

    try {
      await caller.throwError();
      expect(true).toBe(false);
    } catch (err) {
      // tRPC wraps unknown errors in INTERNAL_SERVER_ERROR
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("does not interfere with successful procedures", async () => {
    const caller = createCaller(makeCtx()); // no error to throw

    const result = await caller.throwError();
    expect(result).toEqual({ ok: true });
  });
});
