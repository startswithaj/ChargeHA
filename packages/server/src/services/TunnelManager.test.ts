import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { TunnelManager } from "./TunnelManager.ts";
import type { PluginTunnelRoute } from "@chargeha/plugins/types";

describe("TunnelManager", () => {
  // ── Test Helpers ────────────────────────────────────────────────────────────

  const mockLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  };

  /** Create a ReadableStream from string chunks. */
  function createReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => {
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      },
    });
  }

  /** Create a ReadableStream that never provides data (hangs on read). */
  function createHangingStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      pull() {
        return new Promise(() => {}); // Never resolves
      },
    });
  }

  /** Create a mock ChildProcess with controllable stderr and status. */
  function createMockProcess(options: {
    stderrChunks?: string[];
    hangingStderr?: boolean;
    pid?: number;
    killBehavior?: "normal" | "throws";
  }) {
    let resolveStatus: (s: Deno.CommandStatus) => void = () => {};
    const statusPromise = new Promise<Deno.CommandStatus>(
      (r) => resolveStatus = r,
    );

    const stderr = options.hangingStderr
      ? createHangingStream()
      : createReadableStream(options.stderrChunks ?? []);

    const process = {
      pid: options.pid ?? 1234,
      stderr,
      stdout: createReadableStream([]),
      stdin: null,
      status: statusPromise,
      output: () =>
        Promise.resolve({
          success: true,
          code: 0,
          signal: null,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        }),
      kill: (_signal: string) => {
        if (options.killBehavior === "throws") {
          throw new Error("Process already exited");
        }
        resolveStatus({
          success: false,
          code: 0,
          signal: null,
        } as Deno.CommandStatus);
      },
      ref: () => {},
      unref: () => {},
      [Symbol.dispose]: () => {},
    } as unknown as Deno.ChildProcess;

    return { process, resolveStatus };
  }

  // ── Stubs ───────────────────────────────────────────────────────────────────

  interface MockCommandOptions {
    mockProcess: Deno.ChildProcess;
    throwOnSpawn?: Error;
  }

  let capturedMiddlewareHandler:
    | ((req: Request) => Response | Promise<Response>)
    | null = null;

  let mockServerShutdownCalled = false;

  // Fake Deno.serve injected into the manager; records the handler it registers.
  const mockServe = ((
    _options: unknown,
    handler: (req: Request) => Response | Promise<Response>,
  ) => {
    capturedMiddlewareHandler = handler;
    return {
      shutdown: () => {
        mockServerShutdownCalled = true;
        return Promise.resolve();
      },
      finished: Promise.resolve(),
      ref: () => {},
      unref: () => {},
      addr: { transport: "tcp", hostname: "localhost", port: 4040 },
    };
  }) as unknown as typeof Deno.serve;

  // The command factory the injected wrapper delegates to. A test sets it via
  // stubDenoCommand() — even after constructing the manager, before start().
  const commandHolder = {
    factory: (() => {
      throw new Error("Deno.Command not stubbed for this test");
    }) as unknown as typeof Deno.Command,
  };

  const lazyCommand = function (
    this: unknown,
    path: string | URL,
    options?: Deno.CommandOptions,
  ) {
    return new commandHolder.factory(path, options);
  } as unknown as typeof Deno.Command;

  /** Reset the captured middleware-server state between tests. */
  function stubDenoServe(): void {
    mockServerShutdownCalled = false;
    capturedMiddlewareHandler = null;
  }

  function stubDenoCommand(options: MockCommandOptions): void {
    commandHolder.factory = function MockCommand(this: unknown) {
      return {
        spawn(): Deno.ChildProcess {
          if (options.throwOnSpawn) throw options.throwOnSpawn;
          return options.mockProcess;
        },
      };
    } as unknown as typeof Deno.Command;
  }

  /** Routes returned by the injected provider — tests mutate between calls. */
  const routesHolder: { routes: PluginTunnelRoute[] } = { routes: [] };

  /** Construct a TunnelManager with the fake serve + command injected. */
  const makeTunnelManager = (
    logger: unknown = mockLogger,
    middlewarePort = 4040,
  ): TunnelManager => {
    routesHolder.routes = [];
    return new TunnelManager(
      logger as never,
      3000,
      () => routesHolder.routes,
      middlewarePort,
      "cloudflared",
      mockServe,
      lazyCommand,
    );
  };

  // ── Tests ───────────────────────────────────────────────────────────────────

  describe("initial state", () => {
    it("isRunning returns false initially", () => {
      const tm = makeTunnelManager();
      expect(tm.isRunning).toBe(false);
    });

    it("tunnelUrl returns null initially", () => {
      const tm = makeTunnelManager();
      expect(tm.tunnelUrl).toBeNull();
    });
  });

  describe("start() route serving", () => {
    it("serves plugin-provided routes on the middleware server", async () => {
      const { process } = createMockProcess({
        stderrChunks: [
          "https://test-tunnel.trycloudflare.com\n",
          "more output\n",
        ],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      routesHolder.routes = [
        {
          path: "/test",
          handler: () => new Response("ok"),
        },
      ];

      await tm.start();

      // Verify handler route works via captured middleware handler
      assertExists(capturedMiddlewareHandler);
      const resp = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/test"),
      );
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("ok");

      await tm.stop();
    });
  });

  describe("start()", () => {
    it("returns existing URL when tunnel is already running", async () => {
      const { process } = createMockProcess({
        stderrChunks: [
          "https://existing-tunnel.trycloudflare.com\n",
          "done\n",
        ],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      const url1 = await tm.start();
      expect(url1).toBe("https://existing-tunnel.trycloudflare.com");

      // Second call should return same URL without re-spawning
      const url2 = await tm.start();
      expect(url2).toBe("https://existing-tunnel.trycloudflare.com");

      await tm.stop();
    });

    it("merges routes from a second start() call into the live set", async () => {
      const { process } = createMockProcess({
        stderrChunks: ["https://tunnel.trycloudflare.com\n"],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      routesHolder.routes = [
        { path: "/a", handler: () => new Response("a") },
      ];
      await tm.start();
      routesHolder.routes = [
        { path: "/b", handler: () => new Response("b") },
      ];
      await tm.start();

      assertExists(capturedMiddlewareHandler);
      const respA = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/a"),
      );
      expect(await respA.text()).toBe("a");
      const respB = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/b"),
      );
      expect(await respB.text()).toBe("b");

      await tm.stop();
    });

    it("warns and skips duplicate-path routes on merge", async () => {
      const warnCalls: string[] = [];
      const logger = {
        ...mockLogger,
        warn: (msg: string) => warnCalls.push(msg),
      };
      const { process } = createMockProcess({
        stderrChunks: ["https://tunnel.trycloudflare.com\n"],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager(logger);
      routesHolder.routes = [
        { path: "/dup", handler: () => new Response("first") },
      ];
      await tm.start();
      routesHolder.routes = [
        { path: "/dup", handler: () => new Response("second") },
      ];
      await tm.start();

      assertExists(capturedMiddlewareHandler);
      const resp = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/dup"),
      );
      expect(await resp.text()).toBe("first");
      expect(
        warnCalls.some((m) => m.includes(`"/dup" already registered`)),
      ).toBe(true);

      await tm.stop();
    });

    it("clears routes on stop so a fresh start registers cleanly", async () => {
      const { process: proc1 } = createMockProcess({
        stderrChunks: ["https://tunnel-1.trycloudflare.com\n"],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: proc1 });

      const tm = makeTunnelManager();
      routesHolder.routes = [
        { path: "/old", handler: () => new Response("old") },
      ];
      await tm.start();
      await tm.stop();

      const { process: proc2 } = createMockProcess({
        stderrChunks: ["https://tunnel-2.trycloudflare.com\n"],
      });
      stubDenoCommand({ mockProcess: proc2 });
      stubDenoServe();

      routesHolder.routes = [
        { path: "/new", handler: () => new Response("new") },
      ];
      await tm.start();

      assertExists(capturedMiddlewareHandler);
      const respOld = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/old"),
      );
      expect(respOld.status).toBe(404);
      const respNew = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/new"),
      );
      expect(await respNew.text()).toBe("new");

      await tm.stop();
    });

    it("spawns cloudflared and parses tunnel URL from stderr", async () => {
      const { process } = createMockProcess({
        stderrChunks: [
          "INFO Starting tunnel\n",
          "https://my-tunnel.trycloudflare.com connected\n",
        ],
        pid: 5678,
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      const url = await tm.start();

      expect(url).toBe("https://my-tunnel.trycloudflare.com");
      expect(tm.tunnelUrl).toBe("https://my-tunnel.trycloudflare.com");
      expect(tm.isRunning).toBe(true);

      await tm.stop();
    });

    it("throws specific error when cloudflared binary not found", async () => {
      stubDenoServe();
      stubDenoCommand({
        mockProcess: null as unknown as Deno.ChildProcess,
        throwOnSpawn: new Deno.errors.NotFound("not found"),
      });

      const tm = makeTunnelManager();

      await expect(tm.start()).rejects.toThrow(
        "cloudflared binary not found",
      );
      expect(tm.isRunning).toBe(false);
      // Middleware should be stopped on error
      expect(mockServerShutdownCalled).toBe(true);
    });

    it("rethrows non-NotFound errors from cloudflared spawn", async () => {
      stubDenoServe();
      stubDenoCommand({
        mockProcess: null as unknown as Deno.ChildProcess,
        throwOnSpawn: new Error("permission denied"),
      });

      const tm = makeTunnelManager();

      await expect(tm.start()).rejects.toThrow("permission denied");
      expect(mockServerShutdownCalled).toBe(true);
    });

    it("rejects with timeout when tunnel URL not found in stderr", async () => {
      const fakeTime = new FakeTime();
      try {
        const { process } = createMockProcess({ hangingStderr: true });
        stubDenoServe();
        stubDenoCommand({ mockProcess: process });

        const tm = makeTunnelManager();
        const startPromise = tm.start();

        // Advance past the 15-second timeout
        await fakeTime.tickAsync(16_000);

        await expect(startPromise).rejects.toThrow(
          "Timed out waiting for cloudflared tunnel URL",
        );
      } finally {
        fakeTime.restore();
      }
    });

    it("rejects with timeout when stderr closes without URL", async () => {
      const fakeTime = new FakeTime();
      try {
        const { process } = createMockProcess({
          stderrChunks: ["no url here\n", "still no url\n"],
        });
        stubDenoServe();
        stubDenoCommand({ mockProcess: process });

        const tm = makeTunnelManager();
        const startPromise = tm.start();

        // Advance past the 15-second timeout
        await fakeTime.tickAsync(16_000);

        await expect(startPromise).rejects.toThrow(
          "Timed out waiting for cloudflared tunnel URL",
        );
      } finally {
        fakeTime.restore();
      }
    });
  });

  describe("process exit monitoring", () => {
    it("clears state when cloudflared exits unexpectedly", async () => {
      const { process, resolveStatus } = createMockProcess({
        stderrChunks: [
          "https://tunnel.trycloudflare.com\n",
          "output\n",
        ],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      await tm.start();
      expect(tm.isRunning).toBe(true);

      // Simulate cloudflared exiting
      resolveStatus(
        { success: false, code: 1, signal: null } as Deno.CommandStatus,
      );
      // Allow the .then() callback to execute
      await new Promise((r) => setTimeout(r, 10));

      expect(tm.isRunning).toBe(false);
      expect(tm.tunnelUrl).toBeNull();
    });
  });

  describe("stop()", () => {
    it("is safe to call when not running", async () => {
      const tm = makeTunnelManager();
      await tm.stop();
      expect(tm.isRunning).toBe(false);
      expect(tm.tunnelUrl).toBeNull();
    });

    it("kills the process and shuts down middleware when running", async () => {
      const { process } = createMockProcess({
        stderrChunks: [
          "https://tunnel.trycloudflare.com\n",
          "done\n",
        ],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      await tm.start();
      expect(tm.isRunning).toBe(true);

      await tm.stop();
      expect(tm.isRunning).toBe(false);
      expect(tm.tunnelUrl).toBeNull();
      expect(mockServerShutdownCalled).toBe(true);
    });

    it("handles process that already exited (kill throws)", async () => {
      const { process } = createMockProcess({
        stderrChunks: [
          "https://tunnel.trycloudflare.com\n",
          "done\n",
        ],
        killBehavior: "throws",
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      await tm.start();

      // stop() should not throw even when kill throws
      await tm.stop();
      expect(tm.isRunning).toBe(false);
      expect(tm.tunnelUrl).toBeNull();
    });
  });

  describe("middleware handler", () => {
    let tm: TunnelManager;

    beforeEach(() => {
      const { process } = createMockProcess({
        stderrChunks: [
          "https://tunnel.trycloudflare.com\n",
          "extra output\n",
        ],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });
      tm = makeTunnelManager();
    });

    afterEach(async () => {
      await tm.stop();
    });

    it("serves content from a custom handler route", async () => {
      routesHolder.routes = [
        {
          path: "/custom",
          handler: () => new Response("custom response", { status: 200 }),
        },
      ];
      await tm.start();

      assertExists(capturedMiddlewareHandler);
      const resp = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/custom"),
      );
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("custom response");
    });

    it("serves content from an async handler route", async () => {
      routesHolder.routes = [
        {
          path: "/async",
          handler: async () => {
            await Promise.resolve();
            return new Response("async ok");
          },
        },
      ];
      await tm.start();

      assertExists(capturedMiddlewareHandler);
      const resp = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/async"),
      );
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("async ok");
    });

    it("proxies requests to main server for proxy routes", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (_input: string | URL | Request) => {
        return Promise.resolve(
          new Response("<html>Proxied</html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
        );
      };

      try {
        routesHolder.routes = [{ path: "/api/callback", proxy: true }];
        await tm.start();

        assertExists(capturedMiddlewareHandler);
        const resp = await capturedMiddlewareHandler(
          new Request("http://localhost:4040/api/callback?code=abc"),
        );
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe("<html>Proxied</html>");
        expect(resp.headers.get("Content-Type")).toBe("text/html");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns proxied response Content-Type or defaults to text/html", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
        // Response without Content-Type header
        const resp = new Response("data", { status: 200 });
        resp.headers.delete("Content-Type");
        return Promise.resolve(resp);
      };

      try {
        routesHolder.routes = [{ path: "/api/data", proxy: true }];
        await tm.start();

        assertExists(capturedMiddlewareHandler);
        const resp = await capturedMiddlewareHandler(
          new Request("http://localhost:4040/api/data"),
        );
        expect(resp.status).toBe(200);
        expect(resp.headers.get("Content-Type")).toBe("text/html");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns 502 when proxy fetch fails with Error", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
        return Promise.reject(new Error("Connection refused"));
      };

      try {
        routesHolder.routes = [{ path: "/api/broken", proxy: true }];
        await tm.start();

        assertExists(capturedMiddlewareHandler);
        const resp = await capturedMiddlewareHandler(
          new Request("http://localhost:4040/api/broken"),
        );
        expect(resp.status).toBe(502);
        expect(await resp.text()).toBe("Proxy error");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns 502 when proxy fetch fails with non-Error", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
        return Promise.reject("network failure");
      };

      try {
        routesHolder.routes = [{ path: "/api/broken", proxy: true }];
        await tm.start();

        assertExists(capturedMiddlewareHandler);
        const resp = await capturedMiddlewareHandler(
          new Request("http://localhost:4040/api/broken"),
        );
        expect(resp.status).toBe(502);
        expect(await resp.text()).toBe("Proxy error");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns 404 for unknown paths", async () => {
      routesHolder.routes = [{
        path: "/known",
        handler: () => new Response(""),
      }];
      await tm.start();

      assertExists(capturedMiddlewareHandler);
      const resp = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/unknown"),
      );
      expect(resp.status).toBe(404);
      expect(await resp.text()).toBe("Not Found");
    });

    it("skips routes that have neither handler nor proxy", async () => {
      routesHolder.routes = [
        { path: "/no-action" },
        { path: "/with-handler", handler: () => new Response("found") },
      ];
      await tm.start();

      // Route matches /no-action but has no handler or proxy — continues to next route
      assertExists(capturedMiddlewareHandler);
      const resp = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/no-action"),
      );
      expect(resp.status).toBe(404);
      expect(await resp.text()).toBe("Not Found");
    });

    it("returns 404 when no routes are registered", async () => {
      await tm.start();

      assertExists(capturedMiddlewareHandler);
      const resp = await capturedMiddlewareHandler(
        new Request("http://localhost:4040/anything"),
      );
      expect(resp.status).toBe(404);
    });
  });

  describe("pipeStderr", () => {
    it("handles stderr read error gracefully", async () => {
      let chunksSent = 0;
      const encoder = new TextEncoder();
      const errorStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunksSent === 0) {
            chunksSent++;
            controller.enqueue(
              encoder.encode(
                "https://tunnel.trycloudflare.com\n",
              ),
            );
          } else {
            controller.error(new Error("stream error"));
          }
        },
      });

      let resolveStatus: (s: Deno.CommandStatus) => void = () => {};
      const statusPromise = new Promise<Deno.CommandStatus>(
        (r) => resolveStatus = r,
      );
      const process = {
        pid: 1234,
        stderr: errorStream,
        stdout: createReadableStream([]),
        stdin: null,
        status: statusPromise,
        kill: () => {
          resolveStatus(
            { success: false, code: 0, signal: null } as Deno.CommandStatus,
          );
        },
        ref: () => {},
        unref: () => {},
        [Symbol.dispose]: () => {},
        output: () => Promise.resolve({}),
      } as unknown as Deno.ChildProcess;

      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      await tm.start();

      // Allow pipeStderr to encounter the error
      await new Promise((r) => setTimeout(r, 50));

      // Should not throw — error is caught silently
      await tm.stop();
    });

    it("logs non-empty stderr text after URL is parsed", async () => {
      const debugCalls: string[] = [];
      const loggerWithCapture = {
        ...mockLogger,
        debug: (msg: string) => debugCalls.push(msg),
      };

      const { process } = createMockProcess({
        stderrChunks: [
          "https://tunnel.trycloudflare.com\n",
          "debug info line 1\n",
          "debug info line 2\n",
        ],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager(loggerWithCapture);
      await tm.start();

      // Allow pipeStderr to process remaining chunks
      await new Promise((r) => setTimeout(r, 50));

      // pipeStderr should have logged the remaining chunks
      const cloudflaredLogs = debugCalls.filter((m) =>
        m.startsWith("[cloudflared]")
      );
      expect(cloudflaredLogs.length).toBeGreaterThan(0);

      await tm.stop();
    });
  });

  describe("stopMiddleware", () => {
    it("shuts down middleware server when present", async () => {
      const { process } = createMockProcess({
        stderrChunks: ["https://tunnel.trycloudflare.com\n"],
      });
      stubDenoServe();
      stubDenoCommand({ mockProcess: process });

      const tm = makeTunnelManager();
      await tm.start();

      await tm.stop();
      expect(mockServerShutdownCalled).toBe(true);
    });

    it("is safe when no middleware server exists", async () => {
      mockServerShutdownCalled = false;
      const tm = makeTunnelManager();
      // No start() called — no middleware server
      await tm.stop();
      expect(mockServerShutdownCalled).toBe(false);
    });
  });
});
