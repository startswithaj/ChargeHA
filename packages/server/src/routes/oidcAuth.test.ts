import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  getAllSetCookies,
  makeAuthorizationServer,
  setupOidcApp,
} from "./test-helpers/oidcAuthHarness.ts";

describe("OIDC Routes", () => {
  // ── GET /auth/oidc/login ──────────────────────────────────────────────

  describe("GET /auth/oidc/login", () => {
    it("redirects to provider_unreachable when OIDC not initialized", async () => {
      const { app } = setupOidcApp({ uninitialized: true });
      const res = await app.request("/auth/oidc/login");

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=provider_unreachable",
      );
    });

    it("redirects to provider_unreachable when no authorization_endpoint", async () => {
      const { app } = setupOidcApp({
        oidcServer: makeAuthorizationServer({
          authorization_endpoint: undefined,
        }),
      });
      const res = await app.request("/auth/oidc/login");

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=provider_unreachable",
      );
    });

    it("redirects to OIDC provider with correct parameters", async () => {
      const { app } = setupOidcApp({ clientId: "my-client-id" });
      const res = await app.request("/auth/oidc/login");

      expect(res.status).toBe(302);

      const location = res.headers.get("Location");
      assertExists(location);
      const url = new URL(location);

      expect(url.origin).toBe("https://idp.example.com");
      expect(url.pathname).toBe("/authorize");
      expect(url.searchParams.get("client_id")).toBe("my-client-id");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://app.example.com/auth/oidc/callback",
      );
      expect(url.searchParams.get("scope")).toBe("openid email profile");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("code_challenge")).toBeTruthy();
    });

    it("sets oidc_code_verifier and oidc_state cookies", async () => {
      const { app } = setupOidcApp();
      const res = await app.request("/auth/oidc/login");

      const cookies = getAllSetCookies(res);
      expect(cookies.length).toBe(2);

      const verifierCookie = cookies.find((c) =>
        c.startsWith("oidc_code_verifier=")
      );
      const stateCookie = cookies.find((c) => c.startsWith("oidc_state="));

      expect(verifierCookie).toBeTruthy();
      expect(stateCookie).toBeTruthy();

      expect(verifierCookie).toContain("HttpOnly");
      expect(verifierCookie).toContain("SameSite=Lax");
      expect(verifierCookie).toContain("Path=/auth/oidc/callback");
      expect(verifierCookie).toContain("Max-Age=600");

      expect(stateCookie).toContain("HttpOnly");
      expect(stateCookie).toContain("SameSite=Lax");
      expect(stateCookie).toContain("Path=/auth/oidc/callback");
      expect(stateCookie).toContain("Max-Age=600");
    });

    // S2: Secure flag toggles with X-Forwarded-Proto.
    const secureCases: Array<
      [scheme: string, headers: HeadersInit, expectSecure: boolean]
    > = [
      ["http", {}, false],
      ["https", { "X-Forwarded-Proto": "https" }, true],
    ];
    secureCases.forEach(([scheme, headers, expectSecure]) => {
      it(
        `${expectSecure ? "sets" : "does not set"} Secure flag on ${scheme}`,
        async () => {
          const { app } = setupOidcApp();
          const res = await app.request("http://localhost/auth/oidc/login", {
            headers,
          });

          const cookies = getAllSetCookies(res);
          cookies.forEach((cookie) => {
            if (expectSecure) expect(cookie).toContain("Secure");
            else expect(cookie).not.toContain("Secure");
          });
        },
      );
    });
  });

  // ── GET /auth/oidc/callback ───────────────────────────────────────────

  describe("GET /auth/oidc/callback", () => {
    it("redirects to provider_unreachable when OIDC not initialized", async () => {
      const { app } = setupOidcApp({ uninitialized: true });
      const res = await app.request(
        "/auth/oidc/callback?code=abc&state=xyz",
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=provider_unreachable",
      );
    });

    it("redirects to provider_denied when error param present", async () => {
      const { app } = setupOidcApp();
      const res = await app.request(
        "/auth/oidc/callback?error=access_denied&error_description=User+denied",
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=provider_denied",
      );
    });

    it("redirects to state_mismatch when OIDC cookies missing", async () => {
      const { app } = setupOidcApp();
      const res = await app.request(
        "/auth/oidc/callback?code=abc&state=xyz",
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=state_mismatch",
      );
    });

    it("redirects to state_mismatch when only one cookie present", async () => {
      const { app } = setupOidcApp();
      const res = await app.request(
        "/auth/oidc/callback?code=abc&state=xyz",
        {
          headers: { Cookie: "oidc_state=xyz" },
        },
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=state_mismatch",
      );
    });

    // R2: assert exact state_mismatch — validateAuthResponse throws a
    // state-mismatch error before any token request, so this is deterministic.
    it("redirects to state_mismatch when state values do not match", async () => {
      const { app } = setupOidcApp();
      const res = await app.request(
        "/auth/oidc/callback?code=abc&state=wrong-state",
        {
          headers: {
            Cookie:
              "oidc_code_verifier=some-verifier; oidc_state=expected-state",
          },
        },
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=state_mismatch",
      );
    });
  });

  // ── Return context: login redirects ───────────────────────────────────

  describe("GET /auth/oidc/login with return param", () => {
    it("sets oidc_return cookie when return=wizard", async () => {
      const { app } = setupOidcApp({ clientId: "my-client-id" });
      const res = await app.request("/auth/oidc/login?return=wizard");

      expect(res.status).toBe(302);
      const cookies = getAllSetCookies(res);
      expect(cookies.length).toBe(3);

      const returnCookie = cookies.find((c) => c.startsWith("oidc_return="));
      expect(returnCookie).toBeTruthy();
      expect(returnCookie).toContain("oidc_return=wizard");
      expect(returnCookie).toContain("HttpOnly");
    });

    it("sets oidc_return=settings cookie", async () => {
      const { app } = setupOidcApp({ clientId: "my-client-id" });
      const res = await app.request("/auth/oidc/login?return=settings");

      expect(res.status).toBe(302);
      const cookies = getAllSetCookies(res);
      expect(cookies.length).toBe(3);

      const returnCookie = cookies.find((c) => c.startsWith("oidc_return="));
      expect(returnCookie).toBeTruthy();
      expect(returnCookie).toContain("oidc_return=settings");
    });

    it("does not set oidc_return cookie without return param", async () => {
      const { app } = setupOidcApp({ clientId: "my-client-id" });
      const res = await app.request("/auth/oidc/login");

      const cookies = getAllSetCookies(res);
      expect(cookies.length).toBe(2);
      const returnCookie = cookies.find((c) => c.startsWith("oidc_return="));
      expect(returnCookie).toBeUndefined();
    });

    // S5: provider_unreachable across all three return contexts.
    const providerUnreachableCases: Array<
      [query: string, expectedLocation: string]
    > = [
      ["", "/login?error=provider_unreachable"],
      ["?return=wizard", "/wizard?error=provider_unreachable"],
      ["?return=settings", "/settings?error=provider_unreachable"],
    ];
    providerUnreachableCases.forEach(([query, expectedLocation]) => {
      it(
        `redirects errors to ${
          expectedLocation.split("?")[0]
        } when OIDC not initialized (query=${query || "<none>"})`,
        async () => {
          const { app } = setupOidcApp({ uninitialized: true });
          const res = await app.request(`/auth/oidc/login${query}`);

          expect(res.status).toBe(302);
          expect(res.headers.get("Location")).toBe(expectedLocation);
        },
      );
    });
  });

  // ── Return context: callback redirects ────────────────────────────────

  describe("GET /auth/oidc/callback with oidc_return cookie", () => {
    // S5: provider_denied across both return contexts.
    const providerDeniedCases: Array<
      [returnValue: string, expectedPrefix: string]
    > = [
      ["wizard", "/wizard"],
      ["settings", "/settings"],
    ];
    providerDeniedCases.forEach(([returnValue, expectedPrefix]) => {
      it(`redirects errors to ${expectedPrefix} when oidc_return=${returnValue}`, async () => {
        const { app } = setupOidcApp();
        const res = await app.request(
          "/auth/oidc/callback?error=access_denied&error_description=User+denied",
          {
            headers: { Cookie: `oidc_return=${returnValue}` },
          },
        );

        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe(
          `${expectedPrefix}?error=provider_denied`,
        );
      });
    });

    // S5: state_mismatch (missing OIDC cookies) across both return contexts.
    const stateMismatchCases: Array<
      [returnValue: string, expectedPrefix: string]
    > = [
      ["wizard", "/wizard"],
      ["settings", "/settings"],
    ];
    stateMismatchCases.forEach(([returnValue, expectedPrefix]) => {
      it(`redirects to ${expectedPrefix} on missing cookies when oidc_return=${returnValue}`, async () => {
        const { app } = setupOidcApp();
        const res = await app.request(
          "/auth/oidc/callback?code=abc&state=xyz",
          {
            headers: { Cookie: `oidc_return=${returnValue}` },
          },
        );

        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe(
          `${expectedPrefix}?error=state_mismatch`,
        );
      });
    });
  });
});
