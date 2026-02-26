import { describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import {
  handleAuthError,
  invalidateConfigOnMutation,
  isUnauthorizedError,
  queryClient,
  shouldRetry,
} from "./trpcSetup.ts";

describe("trpcSetup", () => {
  const unauthorizedError = () =>
    new TRPCClientError("Unauthorized", {
      result: {
        error: {
          code: -32001,
          message: "Unauthorized",
          data: { code: "UNAUTHORIZED", httpStatus: 401 },
        },
      },
    });

  describe("isUnauthorizedError", () => {
    it("returns true for TRPCClientError with UNAUTHORIZED data code", () => {
      expect(isUnauthorizedError(unauthorizedError())).toBe(true);
    });

    it("returns true for TRPCClientError with 401 response in meta", () => {
      const error = new TRPCClientError("Unauthorized");
      Object.defineProperty(error, "meta", {
        value: { response: { status: 401 } },
      });
      expect(isUnauthorizedError(error)).toBe(true);
    });

    it("returns false for non-TRPCClientError", () => {
      expect(isUnauthorizedError(new Error("Unauthorized"))).toBe(false);
    });

    it("returns false for TRPCClientError with different code", () => {
      const error = new TRPCClientError("Bad request", {
        result: {
          error: {
            code: -32600,
            message: "Bad request",
            data: { code: "BAD_REQUEST", httpStatus: 400 },
          },
        },
      });
      expect(isUnauthorizedError(error)).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isUnauthorizedError(null)).toBe(false);
      expect(isUnauthorizedError(undefined)).toBe(false);
    });

    it("returns false for TRPCClientError with no data or meta", () => {
      const error = new TRPCClientError("Some error");
      expect(isUnauthorizedError(error)).toBe(false);
    });
  });

  describe("queryClient configuration", () => {
    describe("default query options", () => {
      it("has 30s staleTime", () => {
        expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(30_000);
      });

      it("has refetchOnWindowFocus enabled", () => {
        expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus)
          .toBe(true);
      });
    });
  });

  describe("shouldRetry", () => {
    it("returns false for UNAUTHORIZED errors", () => {
      expect(shouldRetry(0, unauthorizedError())).toBe(false);
    });

    it("returns true for first failure with non-auth error", () => {
      expect(shouldRetry(0, new Error("Network error"))).toBe(true);
    });

    it("returns false after first retry for non-auth error", () => {
      expect(shouldRetry(1, new Error("Network error"))).toBe(false);
    });
  });

  describe("handleAuthError", () => {
    it("clears queryClient on unauthorized error", () => {
      const clearSpy = vi.spyOn(queryClient, "clear");
      handleAuthError(unauthorizedError());
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it("does not clear queryClient on non-auth error", () => {
      const clearSpy = vi.spyOn(queryClient, "clear");
      handleAuthError(new Error("Network error"));
      expect(clearSpy).not.toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe("invalidateConfigOnMutation", () => {
    it("invalidates config queries", () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      invalidateConfigOnMutation();
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [["config", "getAll"]],
      });
      invalidateSpy.mockRestore();
    });
  });
});
