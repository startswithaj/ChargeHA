/**
 * Deno lint plugin that disallows plugin code calling core (main) tRPC
 * routers. Plugins must stay behind their defined API: their own router
 * (`trpc.plugin.vehicle.<id>` / `trpc.plugin.energy.<id>`) plus the host UI
 * surface — never core routers like `wizard`, `vehicle`, or `health`.
 *
 * Catches member chains rooted at `trpc` or `utils` (optionally through
 * `.client`) whose first router segment is a core router name, e.g.:
 *   trpc.wizard.tunnelStatus.useQuery()
 *   utils.vehicle.list.invalidate()
 *   utils.client.vehicle.setPriority.mutate()
 *
 * `trpc.plugin.…` chains are always allowed. Only files under
 * packages/plugins/ are checked; test files are excluded.
 *
 * To intentionally keep a known violation (tracked tech debt), prefix the
 * line with:
 *   // deno-lint-ignore custom-main-refs/no-main-trpc
 */

const CORE_ROUTERS: readonly string[] = [
  "auth",
  "energy",
  "subscription",
  "stats",
  "vehicle",
  "config",
  "health",
  "tariff",
  "schedule",
  "log",
  "notification",
  "wizard",
];

const ROOT_NAMES: readonly string[] = ["trpc", "utils"];

// Properties that may sit between the root and the router segment without
// changing what is being addressed (useUtils' escape hatch to the raw client).
const PASSTHROUGH_PROPS: readonly string[] = ["client"];

function isPluginFile(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  if (normalised.endsWith(".test.ts") || normalised.endsWith(".test.tsx")) {
    return false;
  }
  return normalised.includes("/packages/plugins/");
}

/** Root identifier of a member chain (`utils` for `utils.client.vehicle`),
 *  provided every intermediate property is a passthrough — else null. */
function chainRoot(node: Deno.lint.MemberExpression): string | null {
  const walk = (
    object: Deno.lint.MemberExpression["object"],
  ): string | null => {
    if (object.type === "Identifier") return object.name;
    if (
      object.type === "MemberExpression" &&
      object.property.type === "Identifier" &&
      PASSTHROUGH_PROPS.includes(object.property.name)
    ) {
      return walk(object.object);
    }
    return null;
  };
  return walk(node.object);
}

export default {
  name: "custom-main-refs",
  rules: {
    "no-main-trpc": {
      create(context) {
        if (!isPluginFile(context.filename)) return {};
        return {
          MemberExpression(node: Deno.lint.MemberExpression) {
            if (node.property.type !== "Identifier") return;
            const routerName = node.property.name;
            if (!CORE_ROUTERS.includes(routerName)) return;
            const root = chainRoot(node);
            if (root === null || !ROOT_NAMES.includes(root)) return;
            context.report({
              node,
              message:
                `Plugin code calls core tRPC router '${routerName}' — plugins must use their own router ` +
                `(trpc.plugin.vehicle.<id> / trpc.plugin.energy.<id>) or the host-provided plugin API.`,
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
