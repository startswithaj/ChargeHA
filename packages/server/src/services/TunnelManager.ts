/// <reference lib="deno.ns" />
import type { Logger } from "../lib/Logger.ts";
import type { PluginTunnelRoute } from "@chargeha/plugins/types";

/**
 * Manages a cloudflared tunnel + middleware server for LAN users.
 * Plugin-provided routes come from the injected `getRoutes` provider at
 * `start()` time — TunnelManager itself does not hold a plugin reference.
 * The tunnel provides a temporary https://xxx.trycloudflare.com URL.
 */
export class TunnelManager {
  private process: Deno.ChildProcess | null = null;
  private middlewareServer: Deno.HttpServer | null = null;
  private _tunnelUrl: string | null = null;
  private routes: PluginTunnelRoute[] = [];

  constructor(
    private logger: Logger,
    private mainServerPort: number,
    private getRoutes: () => PluginTunnelRoute[],
    private middlewarePort = 4040,
    private cloudflaredPath = "cloudflared",
    // Injected so tests can supply fakes instead of patching Deno globals.
    private serve: typeof Deno.serve = Deno.serve,
    private command: typeof Deno.Command = Deno.Command,
  ) {}

  /**
   * Merge new routes into the live route set, deduping by path.
   * First registration wins; later collisions are warned and skipped so
   * callers can tell their route was dropped.
   */
  private mergeRoutes(incoming: PluginTunnelRoute[]): void {
    incoming.forEach((route) => {
      if (this.routes.some((r) => r.path === route.path)) {
        this.logger.warn(
          `Tunnel route "${route.path}" already registered, ignoring duplicate`,
        );
        return;
      }
      this.routes.push(route);
    });
  }

  get isRunning(): boolean {
    return this.process !== null && this._tunnelUrl !== null;
  }

  get tunnelUrl(): string | null {
    return this._tunnelUrl;
  }

  /**
   * Start the middleware server and cloudflared tunnel.
   * Returns the public tunnel URL. Plugin-provided routes come from the
   * injected provider (backed by the plugin registry).
   */
  async start(): Promise<string> {
    const routes = this.getRoutes();
    if (this.isRunning && this._tunnelUrl) {
      this.mergeRoutes(routes);
      this.logger.info("Tunnel already running, returning existing URL");
      return this._tunnelUrl;
    }

    this.routes = [];
    this.mergeRoutes(routes);

    const mainServerPort = this.mainServerPort;
    const logger = this.logger;

    this.middlewareServer = this.serve(
      { port: this.middlewarePort, onListen: () => {} },
      async (req: Request) => {
        const url = new URL(req.url);

        // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
        for (const route of this.routes) {
          if (url.pathname !== route.path) continue;

          // Custom handler
          if (route.handler) {
            return await route.handler(req);
          }

          // Proxy to main server
          if (route.proxy) {
            try {
              const mainUrl =
                `http://localhost:${mainServerPort}${url.pathname}${url.search}`;
              const resp = await fetch(mainUrl);
              const body = await resp.text();
              return new Response(body, {
                status: resp.status,
                headers: {
                  "Content-Type": resp.headers.get("Content-Type") ||
                    "text/html",
                },
              });
            } catch (err) {
              logger.error(
                `Failed to proxy ${url.pathname}: ${
                  err instanceof Error ? err.message : err
                }`,
              );
              return new Response("Proxy error", { status: 502 });
            }
          }
        }

        return new Response("Not Found", { status: 404 });
      },
    );

    this.logger.info(
      `Middleware server started on port ${this.middlewarePort}`,
    );

    // Spawn cloudflared tunnel
    try {
      const cmd = new this.command(this.cloudflaredPath, {
        args: ["tunnel", "--url", `http://localhost:${this.middlewarePort}`],
        stdout: "piped",
        stderr: "piped",
      });

      this.process = cmd.spawn();
      this.logger.info(`cloudflared started (PID ${this.process.pid})`);

      // Parse the tunnel URL from stderr
      this._tunnelUrl = await this.parseTunnelUrl(this.process);
      this.logger.info(`Tunnel URL: ${this._tunnelUrl}`);

      // Continue piping stderr in background
      this.pipeStderr(this.process);

      // Monitor for unexpected exit
      this.process.status.then((status: Deno.CommandStatus) => {
        this.logger.warn(`cloudflared exited with code ${status.code}`);
        this.process = null;
        this._tunnelUrl = null;
      });

      return this._tunnelUrl;
    } catch (err) {
      await this.stopMiddleware();

      if (err instanceof Deno.errors.NotFound) {
        this.logger.warn(
          `cloudflared binary not found at "${this.cloudflaredPath}"`,
        );
        throw new Error(
          "cloudflared binary not found. Install it or set CLOUDFLARED_PATH.",
        );
      }
      throw err;
    }
  }

  /** Stop the tunnel process and middleware server. */
  async stop(): Promise<void> {
    if (this.process) {
      try {
        this.process.kill("SIGTERM");
        await this.process.status;
      } catch (error) {
        // Process already exited
        this.logger.debug(`Process already exited: ${error}`);
      }
      this.process = null;
      this.logger.info("cloudflared tunnel stopped");
    }

    await this.stopMiddleware();
    this._tunnelUrl = null;
    this.routes = [];
  }

  /**
   * Parse stderr for the tunnel URL. cloudflared prints a line like:
   *   https://some-words.trycloudflare.com
   * Waits up to 15 seconds.
   */
  private parseTunnelUrl(process: Deno.ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      const decoder = new TextDecoder();
      const reader = process.stderr.getReader();
      // stream buffer accumulated across async reads
      // deno-lint-ignore custom-no-let/no-let
      let buffer = "";

      const timeout = setTimeout(() => {
        reader.releaseLock();
        reject(new Error("Timed out waiting for cloudflared tunnel URL"));
      }, 15_000);

      const read = async () => {
        try {
          // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value);
            const match = buffer.match(
              /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
            );
            if (match) {
              clearTimeout(timeout);
              reader.releaseLock();
              resolve(match[0]);
              return;
            }
          }
        } catch (error) {
          // Reader was released by timeout
          this.logger.debug(`Tunnel URL reader released: ${error}`);
        }
      };

      read();
    });
  }

  /** Pipe remaining stderr to logger after URL has been parsed. */
  private async pipeStderr(process: Deno.ChildProcess): Promise<void> {
    const decoder = new TextDecoder();
    const reader = process.stderr.getReader();
    try {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value).trim();
        if (text) this.logger.debug(`[cloudflared] ${text}`);
      }
    } catch (error) {
      // Process exited
      this.logger.debug(`Cloudflared stderr pipe ended: ${error}`);
    }
  }

  private async stopMiddleware(): Promise<void> {
    if (this.middlewareServer) {
      await this.middlewareServer.shutdown();
      this.middlewareServer = null;
      this.logger.info("Middleware server stopped");
    }
  }
}
