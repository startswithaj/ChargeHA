import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { OidcService } from "./OidcService.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("OidcService", () => {
  const extractFetchUrl = (input: string | URL | Request): string => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  };

  const createMockLogger = (): Logger =>
    throwingMock<Logger>("Logger", {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    });

  const createMockDb = (overrides: Partial<AppDatabase> = {}): AppDatabase =>
    throwingMock<AppDatabase>("AppDatabase", {
      getConfig: () => Promise.resolve(null),
      getOidcConfig: () => Promise.resolve(null),
      ...overrides,
    });

  const oidcRow = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    issuerUrl: "https://auth.example.com",
    clientId: "my-client",
    clientSecret: "my-secret",
    isEncrypted: false,
    baseUrl: "https://app.example.com/",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  });

  const DISCOVERY_DOC = {
    issuer: "https://auth.example.com",
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    jwks_uri: "https://auth.example.com/jwks",
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getState", () => {
    it("returns null when auth_mode is not 'oidc'", async () => {
      const db = createMockDb({
        getConfig: () => Promise.resolve("local"),
      });
      const service = new OidcService(db, null, createMockLogger());
      expect(await service.getState()).toBeNull();
    });

    it("returns null when OIDC config is not present", async () => {
      const db = createMockDb({
        getConfig: () => Promise.resolve("oidc"),
        getOidcConfig: () => Promise.resolve(null),
      });
      const service = new OidcService(db, null, createMockLogger());
      expect(await service.getState()).toBeNull();
    });

    it("returns a resolved state when discovery succeeds", async () => {
      globalThis.fetch = (input: string | URL | Request) => {
        const url = extractFetchUrl(input);
        if (url.includes(".well-known/openid-configuration")) {
          return Promise.resolve(
            new Response(JSON.stringify(DISCOVERY_DOC), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return originalFetch(input);
      };

      const db = createMockDb({
        getConfig: () => Promise.resolve("oidc"),
        getOidcConfig: () => Promise.resolve(oidcRow()),
      });
      const service = new OidcService(db, null, createMockLogger());

      const state = await service.getState();
      assertExists(state);
      expect(state.server.issuer).toBe("https://auth.example.com");
      expect(state.client.client_id).toBe("my-client");
      expect(state.baseUrl).toBe("https://app.example.com");
      expect(state.insecure).toBe(false);
    });

    it("returns null when discovery fails", async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response("not found", { status: 404 }));

      const db = createMockDb({
        getConfig: () => Promise.resolve("oidc"),
        getOidcConfig: () =>
          Promise.resolve(oidcRow({ baseUrl: "https://app.example.com" })),
      });
      const service = new OidcService(db, null, createMockLogger());

      expect(await service.getState()).toBeNull();
    });
  });

  describe("testDiscovery", () => {
    it("returns success when discovery endpoint responds 2xx", async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response("{}", { status: 200 }));

      const service = new OidcService(
        createMockDb(),
        null,
        createMockLogger(),
      );
      const result = await service.testDiscovery("https://auth.example.com");
      expect(result.success).toBe(true);
    });

    it("returns failure when discovery endpoint returns non-2xx", async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response("server error", { status: 500 }));

      const service = new OidcService(
        createMockDb(),
        null,
        createMockLogger(),
      );
      const result = await service.testDiscovery("https://auth.example.com");
      expect(result.success).toBe(false);
      assertExists(result.error);
      expect(result.error).toContain("500");
    });

    it("returns failure when discovery endpoint is unreachable", async () => {
      globalThis.fetch = () => Promise.reject(new Error("network down"));

      const service = new OidcService(
        createMockDb(),
        null,
        createMockLogger(),
      );
      const result = await service.testDiscovery("https://auth.example.com");
      expect(result.success).toBe(false);
      assertExists(result.error);
      expect(result.error).toContain("network down");
    });
  });
});
