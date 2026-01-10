/**
 * Deno lint plugin that bans `let` declarations.
 *
 * Use `const` exclusively. If a value needs to change, restructure with
 * early returns, ternaries, reduce, or extract a helper function.
 * Legitimate exceptions (stores, simulation state, deferred callbacks)
 * should use `// deno-lint-ignore custom-no-let/no-let` with a comment
 * explaining why.
 *
 * Exemptions:
 * - `let` inside for-loop init clauses (inherent to the construct)
 * - `let` at the top of a describe/beforeEach/afterEach callback
 *   (idiomatic test setup pattern)
 */

const TEST_CALLEES = new Set([
  "describe",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "it",
  "test",
  "step",
]);

/** Check if a node is the callback body of a test setup function
 *  (describe, beforeEach, etc.) */
function isTestSetupScope(
  ancestors: Deno.lint.Node[],
): boolean {
  // Walk up to find the nearest function, then check if its parent
  // is a CallExpression for a test setup function.
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression"
    ) {
      const caller = i > 0 ? ancestors[i - 1] : null;
      if (caller?.type !== "CallExpression") return false;
      const callee = (caller as Deno.lint.CallExpression).callee;
      if (
        callee.type === "Identifier" &&
        TEST_CALLEES.has(callee.name)
      ) return true;
      // Handle describe.skip, describe.only, etc.
      if (
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        TEST_CALLEES.has(callee.object.name)
      ) return true;
      return false;
    }
  }
  return false;
}

export default {
  name: "custom-no-let",
  rules: {
    "no-let": {
      create(context) {
        return {
          VariableDeclaration(node: Deno.lint.VariableDeclaration) {
            if (node.kind !== "let") return;

            const ancestors = context.sourceCode.getAncestors(node);
            const parent = ancestors.at(-1);

            // Exempt `let` inside for-loop init clauses
            if (parent?.type === "ForStatement") return;

            // Exempt all `let` in test files — test setup patterns need `let`
            const filename = context.filename;
            if (filename.includes(".test.")) return;

            // Exempt `let` in test setup scopes (describe, beforeEach, etc.)
            if (isTestSetupScope(ancestors)) return;

            context.report({
              node,
              message:
                "Avoid 'let'. Use 'const' with early returns, ternaries, or .reduce() instead.",
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
