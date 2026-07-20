/**
 * Deno lint plugin that bans `_`-prefixed FINAL parameters on functions and
 * arrow functions.
 *
 * A trailing unused parameter can simply be deleted — TypeScript allows a
 * function to take fewer parameters than its declared type, so underscoring
 * it (`function Step(_props: StepProps)`) is noise that hides the real
 * signature. Underscores are only justified for a middle parameter you must
 * skip to reach a later one (`(_item, index) => index`).
 *
 * Class methods are exempt: an implementation may mirror its interface's
 * signature for documentation (`isVehicleOnline(_ctx: CallContext)`).
 * Test files are excluded.
 */

function isTestFile(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  return normalised.endsWith(".test.ts") || normalised.endsWith(".test.tsx");
}

type FunctionNode =
  | Deno.lint.FunctionDeclaration
  | Deno.lint.FunctionExpression
  | Deno.lint.ArrowFunctionExpression;

function check(
  context: Deno.lint.RuleContext,
  node: FunctionNode,
): void {
  // Class methods mirror interface signatures — exempt.
  if (node.parent?.type === "MethodDefinition") return;

  const last = node.params.at(-1);
  if (!last || last.type !== "Identifier") return;
  if (!last.name.startsWith("_")) return;
  context.report({
    node: last,
    message:
      `Trailing unused parameter '${last.name}' — delete it instead of underscoring it; ` +
      `callers may pass fewer arguments than a type declares.`,
  });
}

export default {
  name: "custom-trailing-underscore-param",
  rules: {
    "no-trailing-underscore-param": {
      create(context) {
        if (isTestFile(context.filename)) return {};
        return {
          FunctionDeclaration(node: Deno.lint.FunctionDeclaration) {
            check(context, node);
          },
          FunctionExpression(node: Deno.lint.FunctionExpression) {
            check(context, node);
          },
          ArrowFunctionExpression(node: Deno.lint.ArrowFunctionExpression) {
            check(context, node);
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
