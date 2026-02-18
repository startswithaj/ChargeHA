import { Hono } from "hono";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { TeslaTokenManager } from "./TeslaTokenManager.ts";

/**
 * Tesla plugin HTTP routes for non-JSON responses (OAuth callback HTML, PEM text).
 * Mounted at /api/vehicle/tesla/* by the core bootstrap.
 */
export function createTeslaHttpRoutes(
  tokenManager: TeslaTokenManager,
  deps: PluginDependencies,
): Hono {
  const app = new Hono();

  // GET /callback — OAuth callback, exchanges code for tokens
  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }

    try {
      // Use the same origin that was used to build the authorize URL
      const origin = await deps.getConfig("oauth_origin") ||
        new URL(c.req.url).origin;
      await tokenManager.handleCallback(code, origin);
      // Return a page that closes itself — the original tab is polling for auth status
      return c.html(`<!DOCTYPE html>
<html><body>
<p>Authorization successful. You can close this tab.</p>
<script>window.close()</script>
</body></html>`);
    } catch (error) {
      deps.log.error("Callback failed:", error);
      return c.html(
        `<!DOCTYPE html>
<html><body>
<p>Authorization failed: ${
          error instanceof Error ? error.message : String(error)
        }</p>
<p>You can close this tab and try again.</p>
</body></html>`,
        500,
      );
    }
  });

  // GET /com.tesla.3p.public-key.pem — serves stored EC public key
  app.get("/com.tesla.3p.public-key.pem", async (c) => {
    const publicKey = await deps.getConfig("ec_public_key_pem");
    if (!publicKey) {
      return c.text(
        "Public key not found. Generate keys via the setup wizard first.",
        404,
      );
    }
    return c.text(publicKey, 200, {
      "Content-Type": "text/plain",
    });
  });

  return app;
}
