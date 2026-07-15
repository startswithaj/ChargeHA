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
 * Within the `plugin` namespace, a plugin may only address ITSELF:
 * `trpc.plugin.<kind>.<own-id>.*`, where kind/id derive from the file path
 * (`packages/plugins/vehicles/tesla/…` → `plugin.vehicle.tesla`). Note the
 * plural directory → singular namespace mapping, the dash → underscore id
 * mapping (`fronius-cloud` → `fronius_cloud`), and the energy simulated
 * special case (`energy/simulated` → `simulated_energy`). Shared plugin
 * infrastructure directly under packages/plugins/ has no own id and is
 * exempt from the ownership check. Only files under packages/plugins/ are
 * checked; test files are excluded.
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

interface PluginIdentity {
  kind: "vehicle" | "energy";
  id: string;
}

/** Own namespace identity from the file path, or null for shared plugin
 *  infrastructure directly under packages/plugins/. */
function ownIdentity(filename: string): PluginIdentity | null {
  const match = filename.replace(/\\/g, "/").match(
    /\/packages\/plugins\/(vehicles|energy)\/([^/]+)\//,
  );
  if (!match) return null;
  const kind = match[1] === "vehicles" ? "vehicle" : "energy";
  const dir = match[2].replaceAll("-", "_");
  const id = kind === "energy" && dir === "simulated"
    ? "simulated_energy"
    : dir;
  return { kind, id };
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
    "no-main-imports": {
      create(context) {
        const normalised = context.filename.replace(/\\/g, "/");
        if (!isPluginFile(normalised)) return {};
        if (normalised.endsWith("/packages/plugins/hostUi.ts")) return {};
        return {
          ImportDeclaration(node: Deno.lint.ImportDeclaration) {
            const source = String(node.source.value);
            if (!source.includes("client/src/")) return;
            context.report({
              node: node.source,
              message:
                "Plugin code must not deep-import main's client internals — import the host UI surface " +
                "from packages/plugins/hostUi.ts (add the export there if it's missing).",
            });
          },
        };
      },
    },
    "no-main-trpc": {
      create(context) {
        if (!isPluginFile(context.filename)) return {};
        const own = ownIdentity(context.filename);
        return {
          MemberExpression(node: Deno.lint.MemberExpression) {
            if (node.property.type !== "Identifier") return;
            const routerName = node.property.name;

            if (routerName === "plugin" && own !== null) {
              const root = chainRoot(node);
              if (root === null || !ROOT_NAMES.includes(root)) return;
              // Walk outward: (x.plugin).<kind>.<id>
              const kindNode = node.parent;
              if (
                kindNode?.type !== "MemberExpression" ||
                kindNode.property.type !== "Identifier"
              ) return;
              const kind = kindNode.property.name;
              const idNode = kindNode.parent;
              const id = idNode?.type === "MemberExpression" &&
                  idNode.property.type === "Identifier"
                ? idNode.property.name
                : null;
              if (kind !== own.kind || (id !== null && id !== own.id)) {
                context.report({
                  node,
                  message:
                    `Plugin '${own.id}' addresses foreign plugin namespace 'plugin.${kind}${
                      id ? `.${id}` : ""
                    }' — a plugin may only call its own trpc.plugin.${own.kind}.${own.id}.* endpoints.`,
                });
              }
              return;
            }

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
