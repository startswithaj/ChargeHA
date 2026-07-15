/**
 * Deno lint plugin that bans invoking tRPC routers from server code via
 * `createCallerFactory`.
 *
 * Building a caller over a router and duck-typing its procedures (e.g.
 * `if ("commandStatus" in caller)`) hides a plain function call behind
 * stringly-typed indirection: renaming the procedure breaks nothing at
 * compile time and silently changes behaviour. Server code must call the
 * plugin/service method directly — add the method to the plugin interface
 * if it doesn't exist.
 *
 * Allowed: test files (they legitimately build callers to exercise routers)
 * and the tRPC setup directory that defines/exports the factory.
 */

const ALLOWED_PATH_SEGMENTS: readonly string[] = [
  "/packages/server/src/trpc/",
];

function isAllowedFile(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  if (normalised.endsWith(".test.ts") || normalised.endsWith(".test.tsx")) {
    return true;
  }
  return ALLOWED_PATH_SEGMENTS.some((segment) => normalised.includes(segment));
}

export default {
  name: "custom-server-trpc-caller",
  rules: {
    "no-server-trpc-caller": {
      create(context) {
        if (isAllowedFile(context.filename)) return {};
        return {
          Identifier(node: Deno.lint.Identifier) {
            if (node.name !== "createCallerFactory") return;
            context.report({
              node,
              message:
                "Server code must not invoke routers through tRPC callers — call the plugin/service method directly " +
                "(add it to the plugin interface if it doesn't exist).",
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
