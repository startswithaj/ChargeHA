/**
 * Deno lint plugin that forbids mutating outer-scope collections inside
 * .forEach() callbacks.
 *
 * Use .reduce() to build collections, or restructure to avoid the side effect.
 *
 * Detects, when the mutation target is an outer-scope local variable (not a
 * parameter or local declaration of the enclosing .forEach() callback):
 *   - Mutating method calls: .set(), .push(), .splice(), .add(), .delete(), etc.
 *   - Property assignment: obj.foo = value, obj[key] = value, obj.foo += value
 *   - Update expressions: obj.count++, --obj.index
 *   - Delete: delete obj.foo
 *
 * Does not flag mutation of `this.*` (instance state) or properties of local
 * variables declared inside the callback.
 */

const MUTATING_METHODS = new Set([
  // Array
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  // Map / Set
  "set",
  "delete",
  "clear",
  "add",
]);

/** Walk a MemberExpression chain to find the root identifier. */
function getRootObject(
  node: Deno.lint.Node,
): Deno.lint.Identifier | null {
  let current = node;
  while (current.type === "MemberExpression") {
    current = (current as Deno.lint.MemberExpression).object;
  }
  return current.type === "Identifier"
    ? (current as Deno.lint.Identifier)
    : null;
}

/**
 * Walk ancestors collecting local variable names (declarations + params) up
 * to the nearest enclosing function. If that function is a .forEach() callback
 * and `name` is NOT local to it, return true (mutation of outer scope).
 */
function isOuterVarMutationInForEach(
  name: string,
  ancestors: Deno.lint.Node[],
): boolean {
  const localNames = new Set<string>();

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];

    // Collect declarations from enclosing BlockStatements
    if (node.type === "BlockStatement") {
      for (const stmt of node.body) {
        if (stmt.type === "VariableDeclaration") {
          for (const decl of stmt.declarations) {
            if (decl.id.type === "Identifier") {
              localNames.add(decl.id.name);
            }
          }
        }
      }
      continue;
    }

    // Function boundary
    if (
      node.type !== "ArrowFunctionExpression" &&
      node.type !== "FunctionExpression"
    ) continue;

    // Collect function params
    for (const p of node.params) {
      if (p.type === "Identifier") {
        localNames.add(p.name);
      } else if (
        p.type === "AssignmentPattern" && p.left.type === "Identifier"
      ) {
        localNames.add(p.left.name);
      } else if (
        p.type === "RestElement" && p.argument.type === "Identifier"
      ) {
        localNames.add(p.argument.name);
      }
    }

    // Is this function the callback of a .forEach() call?
    const parent = i > 0 ? ancestors[i - 1] : null;
    if (!parent || parent.type !== "CallExpression") return false;

    if (
      parent.callee.type !== "MemberExpression" ||
      parent.callee.property.type !== "Identifier" ||
      parent.callee.property.name !== "forEach"
    ) return false;

    return !localNames.has(name);
  }
  return false;
}

function checkMutation(
  node: Deno.lint.Node,
  memberExpr: Deno.lint.MemberExpression,
  context: Deno.lint.RuleContext,
  kind: string,
) {
  const root = getRootObject(memberExpr);
  if (!root) return;
  const ancestors = context.sourceCode.getAncestors(node);
  if (!isOuterVarMutationInForEach(root.name, ancestors)) return;
  context.report({
    node,
    message:
      `Do not mutate outer-scope '${root.name}' inside .forEach() (${kind}). Use .reduce() instead.`,
  });
}

export default {
  name: "custom-no-foreach-mutation",
  rules: {
    "no-foreach-mutation": {
      create(context) {
        return {
          // obj.foo = value, obj[key] = value, obj.foo += value
          AssignmentExpression(node: Deno.lint.AssignmentExpression) {
            if (node.left.type !== "MemberExpression") return;
            checkMutation(node, node.left, context, "assignment");
          },

          // obj.count++, --obj.index
          UpdateExpression(node: Deno.lint.UpdateExpression) {
            if (node.argument.type !== "MemberExpression") return;
            checkMutation(node, node.argument, context, "update");
          },

          // delete obj.foo
          UnaryExpression(node: Deno.lint.UnaryExpression) {
            if (node.operator !== "delete") return;
            if (node.argument.type !== "MemberExpression") return;
            checkMutation(node, node.argument, context, "delete");
          },

          CallExpression(node: Deno.lint.CallExpression) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              !MUTATING_METHODS.has(callee.property.name)
            ) return;
            checkMutation(
              node,
              callee,
              context,
              `${callee.property.name}()`,
            );
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
