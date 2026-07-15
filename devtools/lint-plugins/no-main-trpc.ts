/**
 * Deno lint plugin: tRPC calls in plugin code must go through the `plugin`
 * namespace (`trpc.plugin.…` / `utils.plugin.…` / `utils.client.plugin.…`).
 * Any other segment on the `trpc`/`utils` root is flagged — including core
 * routers that don't exist yet. The only other allowed segments are tRPC's
 * own client API words, which aren't endpoints.
 *
 * Only files under packages/plugins/ are checked; test files are excluded.
 * To intentionally keep a known violation (tracked tech debt), prefix the
 * line with:
 *   // deno-lint-ignore custom-main-refs/no-main-trpc
 */

const ROOT_NAMES: readonly string[] = ["trpc", "utils"];

// Allowed first segments after the root: the plugin namespace plus tRPC's
// client API. `client` is useUtils' raw-client escape hatch — what follows
// it is checked separately because `utils.client` is treated as a root too.
const ALLOWED_SEGMENTS: readonly string[] = [
  "plugin",
  "client",
  "useUtils",
];

function isPluginFile(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  if (normalised.endsWith(".test.ts") || normalised.endsWith(".test.tsx")) {
    return false;
  }
  return normalised.includes("/packages/plugins/");
}

/** True for `trpc` / `utils` identifiers and for the `utils.client` /
 *  `trpc.client` member expression — the nodes a router segment hangs off. */
function isTrpcRoot(node: Deno.lint.MemberExpression["object"]): boolean {
  if (node.type === "Identifier") return ROOT_NAMES.includes(node.name);
  return node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    ROOT_NAMES.includes(node.object.name) &&
    node.property.type === "Identifier" &&
    node.property.name === "client";
}

export default {
  name: "custom-main-refs",
  rules: {
    "no-main-trpc": {
      create(context) {
        if (!isPluginFile(context.filename)) return {};
        return {
          MemberExpression(node: Deno.lint.MemberExpression) {
            if (!isTrpcRoot(node.object)) return;
            if (node.property.type !== "Identifier") return;
            if (ALLOWED_SEGMENTS.includes(node.property.name)) return;
            context.report({
              node,
              message:
                `'${node.property.name}' is not under the plugin namespace — tRPC calls in plugin code ` +
                `must go through trpc.plugin.* (or the host-provided plugin API).`,
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
