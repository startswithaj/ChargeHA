/**
 * Deno lint plugin that disallows catch blocks that swallow errors.
 *
 * A catch block must do something meaningful with the error — log it, rethrow it,
 * or assign it. Catch blocks that are empty or only contain comments are flagged.
 *
 * Also flags empty promise catch handlers: `.catch(() => {})`. Handlers that
 * substitute a fallback value (`.catch(() => null)`) are fine — they handle
 * the error rather than swallow it.
 */

/** True for `() => {}` / `function () {}` — a handler that does nothing. */
function isEmptyHandler(
  arg: Deno.lint.CallExpression["arguments"][number],
): boolean {
  if (
    arg.type !== "ArrowFunctionExpression" && arg.type !== "FunctionExpression"
  ) {
    return false;
  }
  return arg.body.type === "BlockStatement" && arg.body.body.length === 0;
}

export default {
  name: "custom-no-swallowed-catch",
  rules: {
    "no-swallowed-catch": {
      create(context) {
        return {
          CatchClause(node: Deno.lint.CatchClause) {
            const body = node.body;
            if (body.body.length === 0) {
              context.report({
                node: body,
                message:
                  "Empty catch block swallows errors. Log the error or rethrow it.",
              });
            }
          },
          CallExpression(node: Deno.lint.CallExpression) {
            if (
              node.callee.type !== "MemberExpression" ||
              node.callee.property.type !== "Identifier" ||
              node.callee.property.name !== "catch" ||
              node.arguments.length !== 1
            ) {
              return;
            }
            if (isEmptyHandler(node.arguments[0])) {
              context.report({
                node: node.arguments[0],
                message:
                  "Empty .catch() handler swallows errors. Log the error or return a fallback value.",
              });
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
