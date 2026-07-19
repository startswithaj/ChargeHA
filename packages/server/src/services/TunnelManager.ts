/// <reference lib="deno.ns" />
import type { Logger } from "../lib/Logger.ts";
import type { PluginTunnelRoute } from "@chargeha/plugins/types";

/** How a tunnel process is spawned and its public URL recognised. */
export interface TunnelProvider {
  name: string;
  path: string;
  /** `{port}` is replaced with the middleware port. */
  args: string[];
  /** Matches the public https URL in the process output. */
  urlPattern: RegExp;
  /** Which stream the provider prints the URL to. */
  urlStream: "stdout" | "stderr";
  /** Free-tier session limit surfaced to the user, if any. */
  expiryMinutes: number | null;
}

/** Pinggy over plain ssh. As of 2026-07 it is the only tested tunnel whose
 *  domain Tesla's developer portal accepts in BOTH the Allowed Origin and
 *  Redirect URI fields — trycloudflare.com, serveousercontent.com,
 *  tunnelmole.net, loca.lt, and Pinggy's own pinggy-free.link alias are all
 *  rejected in at least one (see docs/tesla.md). Free tunnels expire after
 *  60 minutes and embed the user's public IP in the URL. */
export const PINGGY_PROVIDER: TunnelProvider = {
  name: "pinggy",
  path: "ssh",
  args: [
    "-p",
    "443",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ExitOnForwardFailure=yes",
    "-R",
    "0:localhost:{port}",
    "qr@a.pinggy.io",
  ],
  urlPattern: /https:\/\/[a-z0-9-]+\.free\.pinggy\.net/,
  urlStream: "stdout",
  expiryMinutes: 60,
};

/**
 * Manages a tunnel process + middleware server for LAN users.
 * Plugin-provided routes come from the injected `getRoutes` provider at
 * `start()` time — TunnelManager itself does not hold a plugin reference.
 * The tunnel provides a temporary public https URL.
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
    private provider: TunnelProvider = PINGGY_PROVIDER,
    // Injected so tests can supply fakes instead of patching Deno globals.
    private serve: typeof Deno.serve = Deno.serve,
    private command: typeof Deno.Command = Deno.Command,
  ) {}

  /** Free-tier session limit of the active provider, if any. */
  get expiryMinutes(): number | null {
    return this.provider.expiryMinutes;
  }

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
   * Start the middleware server and tunnel process.
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

    // Spawn the tunnel process
    try {
      const cmd = new this.command(this.provider.path, {
        args: this.provider.args.map((a) =>
          a.replace("{port}", String(this.middlewarePort))
        ),
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });

      const process = cmd.spawn();
      this.process = process;
      this.logger.info(
        `${this.provider.name} tunnel started (PID ${process.pid})`,
      );

      this._tunnelUrl = await this.parseTunnelUrl(process);
      this.logger.info(`Tunnel URL: ${this._tunnelUrl}`);

      // Continue piping the URL stream in background
      this.pipeUrlStream(process);

      this.monitorExit(process);

      return this._tunnelUrl;
    } catch (err) {
      await this.stopMiddleware();

      if (err instanceof Deno.errors.NotFound) {
        this.logger.warn(
          `${this.provider.name} binary not found at "${this.provider.path}"`,
        );
        throw new Error(
          `${this.provider.path} binary not found — the tunnel needs it installed.`,
        );
      }
      throw err;
    }
  }

  /** Clear tunnel state when the process exits, expectedly or otherwise. */
  private monitorExit(process: Deno.ChildProcess): void {
    process.status.then((status: Deno.CommandStatus) => {
      this.logger.warn(
        `${this.provider.name} tunnel exited with code ${status.code}`,
      );
      // A stop-then-start can land the old process's exit after the new one is
      // assigned — clearing unconditionally would wipe the live tunnel's URL.
      if (this.process !== process) return;
      this.process = null;
      this._tunnelUrl = null;
    });
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
      this.logger.info("tunnel stopped");
    }

    await this.stopMiddleware();
    this._tunnelUrl = null;
    this.routes = [];
  }

  /**
   * Parse the provider's URL stream for the public tunnel URL.
   * Waits up to 15 seconds.
   */
  private parseTunnelUrl(process: Deno.ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      const decoder = new TextDecoder();
      const reader = process[this.provider.urlStream].getReader();
      // stream buffer accumulated across async reads
      // deno-lint-ignore custom-no-let/no-let
      let buffer = "";

      const timeout = setTimeout(() => {
        reader.releaseLock();
        reject(
          new Error(
            `Timed out waiting for ${this.provider.name} tunnel URL`,
          ),
        );
      }, 15_000);

      const read = async () => {
        try {
          // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value);
            const match = buffer.match(this.provider.urlPattern);
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

  /** Pipe the rest of the URL stream to the logger after parsing. */
  private async pipeUrlStream(process: Deno.ChildProcess): Promise<void> {
    const decoder = new TextDecoder();
    const reader = process[this.provider.urlStream].getReader();
    try {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value).trim();
        if (text) this.logger.debug(`[${this.provider.name}] ${text}`);
      }
    } catch (error) {
      // Process exited
      this.logger.debug(`Tunnel output pipe ended: ${error}`);
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
