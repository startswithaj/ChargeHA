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
    const state = c.req.query("state");
    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }
    if (!state) {
      return c.json({ error: "Missing state parameter" }, 400);
    }

    try {
      // The token exchange must send the exact redirect_uri used at authorize
      // time, so the origin is recorded against the state param. An unknown
      // state means this callback belongs to a handshake this server never
      // started, or one lost to a restart. Either way the stored origin is
      // gone and the exchange can't send a matching redirect_uri.
      const origin = tokenManager.takeAuthOrigin(state);
      if (origin === null) {
        return c.json({ error: "Unrecognised or expired state" }, 400);
      }
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
          escapeHtml(error instanceof Error ? error.message : String(error))
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

/** Escape for HTML text content — the callback renders Tesla's error bodies. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
