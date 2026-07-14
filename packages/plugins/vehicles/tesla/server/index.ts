/// <reference lib="deno.ns" />
import { TRPCError } from "@trpc/server";
import type { Hono } from "hono";
import type { VehicleRow } from "@chargeha/server/db/types";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { generateEcKeyPair } from "@chargeha/server/lib/Encryption";
import type {
  HealthCheckResult,
  PluginHealthCheck,
  PluginTunnelRoute,
  VehicleMiddleware,
  VehiclePlugin,
} from "../../../types.ts";
import { TeslaAdapter } from "./TeslaAdapter.ts";
import { TeslaVehicleMiddleware } from "./TeslaVehicleMiddleware.ts";
import { TeslaProxyManager } from "./TeslaProxyManager.ts";
import { TeslaService, type TeslaServiceIo } from "./TeslaService.ts";
import { TeslaTokenManager } from "./TeslaTokenManager.ts";
import { TESLA_SECRET_KEYS, teslaConfigDef } from "./config.ts";
import { createTeslaHttpRoutes } from "./routes.ts";
import { teslaRouter } from "./router.ts";

const DEFAULT_PROXY_URL = "https://localhost:4443";

/**
 * Reachability check for the tesla-proxy health check. Returns "ok" (no
 * warning) when Tesla isn't set up — the proxy only runs once a private key
 * exists, so an unreachable proxy is only worth warning about then.
 */
export async function checkTeslaProxyHealth(
  deps: {
    getSecret(key: "ec_private_key"): Promise<string | null>;
    getConfig(key: "proxy_url"): Promise<string | null>;
  },
): Promise<HealthCheckResult> {
  if (!(await deps.getSecret("ec_private_key"))) {
    return { status: "ok" };
  }
  try {
    const proxyUrlStr = (await deps.getConfig("proxy_url")) ??
      DEFAULT_PROXY_URL;
    const url = new URL(proxyUrlStr);
    const port = parseInt(url.port || "4443", 10);
    const conn = await Deno.connect({ hostname: url.hostname, port });
    conn.close();
    return { status: "ok" };
  } catch {
    return { status: "error", message: "Tesla proxy not reachable" };
  }
}

/**
 * Tesla vehicle plugin — owns Tesla OAuth, Fleet API proxy, EC key
 * lifecycle, and vehicle adapter creation behind the VehiclePlugin interface.
 *
 * Construction kicks off async startup (proxy start, optional token
 * auto-refresh, DB vehicle load) saved as `startupPromise`. Methods that
 * depend on startup awaited it internally; `shutdown()` awaits it too.
 */
export class TeslaVehiclePlugin implements VehiclePlugin {
  readonly id = "tesla";
  readonly displayName = "Tesla";
  readonly configDef = teslaConfigDef;
  readonly secretKeys = TESLA_SECRET_KEYS;
  readonly settingsComponentKey = "tesla-settings";

  readonly teslaTokenManager: TeslaTokenManager;
  readonly teslaService: TeslaService;

  private readonly startupPromise: Promise<void>;

  constructor(
    private readonly deps: PluginDependencies,
    private readonly teslaProxyManager: TeslaProxyManager,
    serviceIo?: TeslaServiceIo,
  ) {
    this.teslaTokenManager = new TeslaTokenManager(deps, deps.log);
    this.teslaService = new TeslaService(
      deps,
      this.teslaTokenManager,
      deps.log,
      serviceIo,
    );
    this.startupPromise = this.startup();
  }

  private async startup(): Promise<void> {
    // A quick-tunnel public key domain cannot survive a restart (the tunnel
    // runs in-process), so a persisted trycloudflare domain is dead by
    // definition here — clear it so the wizard doesn't present it as
    // configured. Starting a new tunnel re-persists via onTunnelStarted.
    const domain = await this.deps.getConfig("public_key_domain");
    if (domain?.endsWith(".trycloudflare.com")) {
      await this.deps.setConfig("public_key_domain", "");
      this.deps.log.info(
        `Cleared expired tunnel public key domain ${domain}`,
      );
    }

    await this.teslaProxyManager.start();

    const hasCredentials = await this.deps.getConfig("client_id");
    if (hasCredentials || await this.teslaTokenManager.isAuthenticated()) {
      await this.teslaTokenManager.startAutoRefresh();
    }

    const rows = await this.deps.getVehicleRows();
    await Promise.all(rows.map((row) => this.deps.addVehicle(row)));
  }

  async createMiddleware(row: VehicleRow): Promise<VehicleMiddleware> {
    const proxyUrl = (await this.deps.getConfig("proxy_url")) ??
      DEFAULT_PROXY_URL;
    const adapter = new TeslaAdapter(
      row.id,
      this.teslaTokenManager,
      proxyUrl,
      this.deps.log,
      this.deps.dbLog,
    );
    return new TeslaVehicleMiddleware(adapter, this.deps.log);
  }

  async shutdown(): Promise<void> {
    await this.startupPromise.catch(() => {});
    this.teslaTokenManager.stopAutoRefresh();
    await this.teslaProxyManager.stop();
  }

  // ── Key management (writes are auto-prefixed to `tesla.*` by deps) ─────

  async generateKeys(): Promise<{ success: true; publicKey: string }> {
    try {
      const { publicKeyPem, privateKeyPem } = await generateEcKeyPair();
      await this.deps.setConfig("ec_public_key_pem", publicKeyPem);
      await this.deps.setSecret("ec_private_key", privateKeyPem);
      this.deps.log.info("EC key pair generated");
      await this.teslaProxyManager.restart();
      return { success: true as const, publicKey: publicKeyPem };
    } catch (err) {
      this.deps.log.error("Key generation failed", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Key generation failed",
        cause: err,
      });
    }
  }

  async importKeys(
    input: { publicKeyPem: string; privateKeyPem: string },
  ): Promise<{ success: true; publicKey: string }> {
    if (
      !input.privateKeyPem.includes("-----BEGIN PRIVATE KEY-----") &&
      !input.privateKeyPem.includes("-----BEGIN EC PRIVATE KEY-----")
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Invalid private key: must be PEM-encoded (BEGIN PRIVATE KEY or BEGIN EC PRIVATE KEY)",
      });
    }
    try {
      await this.deps.setConfig("ec_public_key_pem", input.publicKeyPem);
      await this.deps.setSecret("ec_private_key", input.privateKeyPem);
      this.deps.log.info("EC key pair imported");
      await this.teslaProxyManager.restart();
      return { success: true as const, publicKey: input.publicKeyPem };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Key import failed",
        cause: err,
      });
    }
  }

  // ── Plugin interface implementations ────────────────────────────────────

  getRouter() {
    return teslaRouter;
  }

  getHttpRoutes(): Hono | null {
    return createTeslaHttpRoutes(this.teslaTokenManager, this.deps);
  }

  /** Tunnel URLs are minted fresh on every start — persist the live one as
   *  the public key domain so partner registration never reads a stale
   *  trycloudflare.com domain (issue #31). */
  async onTunnelStarted(url: string): Promise<void> {
    await this.deps.setConfig("public_key_domain", url);
  }

  /** A stopped tunnel's URL is dead — clear it so the hosting step doesn't
   *  present a stale domain as configured. User-hosted domains are left alone. */
  async onTunnelStopped(url: string): Promise<void> {
    if ((await this.deps.getConfig("public_key_domain")) === url) {
      await this.deps.setConfig("public_key_domain", "");
    }
  }

  getTunnelRoutes(): PluginTunnelRoute[] {
    const deps = this.deps;
    return [
      {
        path: "/.well-known/appspecific/com.tesla.3p.public-key.pem",
        async handler() {
          const publicKey = await deps.getConfig("ec_public_key_pem");
          if (!publicKey) {
            return new Response("Public key not found", { status: 404 });
          }
          return new Response(publicKey, {
            headers: {
              "Content-Type": "text/plain",
              "Access-Control-Allow-Origin": "*",
            },
          });
        },
      },
      {
        path: "/api/vehicle/tesla/callback",
        proxy: true,
      },
    ];
  }

  getHealthChecks(): PluginHealthCheck[] {
    const deps = this.deps;
    return [
      {
        name: "tesla-proxy",
        timeoutMs: 5000,
        warningTitle: "Tesla Proxy Unreachable",
        warningMessage:
          "Vehicle commands will fail. Make sure tesla-http-proxy is running on port 4443.",
        run: () => checkTeslaProxyHealth(deps),
      },
    ];
  }
}
