import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import deno from "@deno/vite-plugin";

/** Dev-only plugin: catches browser errors/unhandled rejections and
 *  logs them to the Vite terminal so they're visible without DevTools. */
function browserErrorRelay(): Plugin {
  return {
    name: "browser-error-relay",
    apply: "serve",
    transformIndexHtml() {
      return [{
        tag: "script",
        attrs: { type: "module" },
        injectTo: "head-prepend",
        children: `
          (function() {
            function send(payload) {
              fetch("/__browser_error", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              }).catch(() => {});
            }
            window.addEventListener("error", function(e) {
              send({
                type: "error",
                message: e.message,
                source: e.filename,
                line: e.lineno,
                col: e.colno,
                stack: e.error?.stack,
              });
            });
            window.addEventListener("unhandledrejection", function(e) {
              var reason = e.reason;
              send({
                type: "unhandledrejection",
                message: reason?.message || String(reason),
                stack: reason?.stack,
              });
            });
            var origError = console.error;
            console.error = function() {
              origError.apply(console, arguments);
              var parts = Array.from(arguments).map(function(a) {
                return typeof a === "string" ? a : a?.message || String(a);
              });
              send({ type: "console.error", message: parts.join(" ") });
            };
          })();
        `,
      }];
    },
    configureServer(server) {
      server.middlewares.use("/__browser_error", (req, res) => {
        if (req.method !== "POST") {
          // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- Vite middleware API
          res.statusCode = 405;
          res.end();
          return;
        }
        // stream buffer accumulated across request chunks
        // deno-lint-ignore custom-no-let/no-let
        let body = "";
        req.on("data", (chunk: string) => body += chunk);
        req.on("end", () => {
          try {
            const err = JSON.parse(body);
            const errorLabels: Record<string, string> = {
              "console.error": "console.error",
              "unhandledrejection": "Unhandled Rejection",
            };
            const label = errorLabels[err.type] ?? "Uncaught Error";
            const pos = `${err.source}:${err.line}:${err.col}`;
            const loc = err.source ? ` at ${pos}` : "";
            server.config.logger.error(
              `\x1b[91m[browser] ${label}: ${err.message}${loc}\x1b[0m`,
            );
            if (err.stack) {
              err.stack.split("\\n").slice(1, 6).forEach((line: string) => {
                server.config.logger.error(`\x1b[90m  ${line.trim()}\x1b[0m`);
              });
            }
          } catch (e) {
            server.config.logger.warn(
              `[browser-error-relay] bad payload: ${e}`,
            );
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// Deno's HTTP server throws unhandled errors when proxied connections drop
// (e.g., backend restart, SSE disconnect). Node logs these as warnings;
// Deno kills the process. This is a known Deno bug (denoland/deno#29111).
globalThis.addEventListener("unhandledrejection", (e) => {
  if (e.reason instanceof TypeError || e.reason instanceof Error) {
    const msg = e.reason.message;
    if (
      msg.includes("body from connection") ||
      msg.includes("cancel") ||
      msg.includes("connection")
    ) {
      e.preventDefault();
    }
  }
});

export default defineConfig({
  plugins: [browserErrorRelay(), deno(), react()],
  server: {
    port: 5175,
    proxy: {
      "/trpc": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/api/vehicle": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../server/dist",
    emptyOutDir: true,
  },
});
