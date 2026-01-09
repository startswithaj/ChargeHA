/**
 * Deno lint plugin that bans complex ternaries and multi-line boolean expressions.
 *
 * Applied globally to all files.
 *
 * Rules:
 * - no-nested-ternary: ConditionalExpression must not contain another
 *   ConditionalExpression in consequent or alternate branches.
 * - no-multiline-ternary: ConditionalExpression must not span more than 3 source
 *   lines. deno fmt wraps simple `a ? b : c` to exactly 3 lines at 80-char width,
 *   so the threshold allows that standard pattern while catching genuinely complex
 *   ternaries (4+ lines with nested logic or long template literals).
 * - no-multiline-boolean: LogicalExpression in variable declarations must not
 *   span more than 2 source lines.
 */

function countLines(sourceText: string, range: [number, number]): number {
  const text = sourceText.slice(range[0], range[1]);
  return text.split("\n").length;
}

export default {
  name: "expression-complexity",
  rules: {
    "no-nested-ternary": {
      create(context) {
        return {
          ConditionalExpression(node) {
            if (node.consequent.type === "ConditionalExpression") {
              context.report({
                node: node.consequent,
                message:
                  "Nested ternary in consequent branch. Use if/else or extract to a helper.",
              });
            }
            if (node.alternate.type === "ConditionalExpression") {
              context.report({
                node: node.alternate,
                message:
                  "Nested ternary in alternate branch. Use if/else or extract to a helper.",
              });
            }
          },
        };
      },
    },
    "no-multiline-ternary": {
      create(context) {
        const sourceText = context.sourceCode.text;

        return {
          ConditionalExpression(node) {
            const lines = countLines(sourceText, node.range);
            if (lines > 3) {
              context.report({
                node,
                message:
                  `Ternary spans ${lines} lines (max 3). Use if/else or extract to a helper.`,
              });
            }
          },
        };
      },
    },
    "no-multiline-boolean": {
      create(context) {
        const sourceText = context.sourceCode.text;

        return {
          VariableDeclarator(node) {
            if (
              node.init &&
              node.init.type === "LogicalExpression"
            ) {
              const lines = countLines(sourceText, node.init.range);
              if (lines > 2) {
                const name = node.id.type === "Identifier"
                  ? node.id.name
                  : "expression";
                context.report({
                  node: node.init,
                  message:
                    `Boolean expression '${name}' spans ${lines} lines (max 2). Extract to named variables or a predicate function.`,
                });
              }
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
