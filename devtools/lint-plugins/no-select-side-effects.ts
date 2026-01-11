/**
 * Deno lint plugin that forbids side effects inside React Query `select`
 * callbacks.
 *
 * `select` runs synchronously during render. Store mutations (or any
 * external state update) inside it cause infinite render loops that crash
 * the browser.
 *
 * Detects:
 * - Calls on identifiers ending in "Store"  (e.g. vehicleErrorStore.setError)
 * - Bare calls whose name starts with a mutation prefix (e.g. notify, dispatch)
 *
 * Scoped to client/src/ files.
 */

const MUTATION_PREFIXES = [
  "set",
  "clear",
  "notify",
  "dispatch",
  "emit",
  "update",
  "remove",
  "delete",
  "push",
  "reset",
];

function isInScope(filename: string): boolean {
  return filename.includes("packages/client/src/") ||
    filename.includes("packages\\client\\src\\");
}

/** `fooStore.setBar(...)` */
function isStoreMutation(node: Deno.lint.CallExpression): boolean {
  const c = node.callee;
  return c.type === "MemberExpression" &&
    c.object.type === "Identifier" &&
    /[Ss]tore$/.test(c.object.name);
}

/** `notify(...)`, `dispatch(...)`, `setFoo(...)` etc. */
function isBareMutationCall(node: Deno.lint.CallExpression): boolean {
  const c = node.callee;
  if (c.type !== "Identifier") return false;
  return MUTATION_PREFIXES.some((p) => c.name.startsWith(p));
}

/**
 * Walk ancestors to check if a node sits inside the `select` property
 * value of a `useQuery` options object.
 */
function isInsideSelectOfUseQuery(ancestors: Deno.lint.Node[]): boolean {
  for (let i = ancestors.length - 1; i >= 2; i--) {
    const fn = ancestors[i];
    if (
      fn.type !== "ArrowFunctionExpression" &&
      fn.type !== "FunctionExpression"
    ) continue;

    const prop = ancestors[i - 1];
    if (!prop || prop.type !== "Property") continue;

    const key = prop.key;
    const isSelect = (key.type === "Identifier" && key.name === "select") ||
      (key.type === "Literal" && key.value === "select");
    if (!isSelect) continue;

    const obj = ancestors[i - 2];
    if (!obj || obj.type !== "ObjectExpression") continue;

    const call = ancestors[i - 3];
    if (!call || call.type !== "CallExpression") continue;

    const callee = call.callee;
    if (callee.type === "Identifier" && callee.name === "useQuery") return true;
    if (
      callee.type === "MemberExpression" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "useQuery"
    ) return true;
  }
  return false;
}

export default {
  name: "custom-no-select-side-effects",
  rules: {
    "no-select-side-effects": {
      create(context) {
        if (!isInScope(context.filename)) return {};

        return {
          CallExpression(node: Deno.lint.CallExpression) {
            if (!isStoreMutation(node) && !isBareMutationCall(node)) return;

            const ancestors = context.sourceCode.getAncestors(node);
            if (!isInsideSelectOfUseQuery(ancestors)) return;

            const name = node.callee.type === "MemberExpression" &&
                node.callee.property.type === "Identifier"
              ? node.callee.property.name
              : node.callee.type === "Identifier"
              ? node.callee.name
              : "unknown";

            context.report({
              node,
              message:
                `'${name}' is a side effect inside a useQuery select callback. select runs during render — side effects here cause infinite loops. Move to useEffect.`,
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
