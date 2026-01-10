/**
 * Deno lint plugin that enforces functional style by banning imperative loops.
 *
 * Detects:
 * - for loops (for, for...of, for...in)
 * - while / do...while loops
 *
 * Use .map(), .filter(), .reduce(), .flatMap(), .forEach() instead.
 */

export default {
  name: "custom-no-imperative-loops",
  rules: {
    "no-imperative-loops": {
      create(context) {
        function report(node: Deno.lint.Node, kind: string) {
          context.report({
            node,
            message:
              `Avoid '${kind}' loops. Use .map(), .filter(), .reduce(), .flatMap(), or .forEach() instead.`,
          });
        }

        return {
          ForStatement(node: Deno.lint.ForStatement) {
            report(node, "for");
          },
          ForOfStatement(node: Deno.lint.ForOfStatement) {
            report(node, "for...of");
          },
          ForInStatement(node: Deno.lint.ForInStatement) {
            report(node, "for...in");
          },
          WhileStatement(node: Deno.lint.WhileStatement) {
            report(node, "while");
          },
          DoWhileStatement(node: Deno.lint.DoWhileStatement) {
            report(node, "do...while");
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
