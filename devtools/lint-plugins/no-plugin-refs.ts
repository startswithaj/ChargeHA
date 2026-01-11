/**
 * Deno lint plugin that disallows hardcoded references to plugin IDs outside
 * the plugins/ directory.
 *
 * Catches:
 * - `tesla` and `fronius` as a case-insensitive substring in identifiers,
 *   string literals, template strings, and JSX text
 * - `simulated` as an exact match only (identifier name or literal string value)
 *   — avoids false positives on generic names like `simulatedLoadW`
 *
 * Scoped out: plugins/, devtools/, shared/simulation/, server/src/db/seeds/,
 * test files, and the lint-plugins directory itself.
 *
 * To intentionally mention a plugin name in user-facing text (e.g. settings
 * help text), prefix the line with:
 *   // deno-lint-ignore custom-plugin-refs/no-plugin-refs
 */

const SUBSTRING_PATTERNS: readonly RegExp[] = [/tesla/i, /fronius/i];

const EXCLUDED_PATH_SEGMENTS: readonly string[] = [
  "packages/plugins/",
  "devtools/",
  "packages/shared/simulation/",
  "packages/server/src/db/seeds/",
  "test-helpers/",
];

function isExcludedFile(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  if (normalised.endsWith(".test.ts") || normalised.endsWith(".test.tsx")) {
    return true;
  }
  return EXCLUDED_PATH_SEGMENTS.some((segment) =>
    normalised.includes(`/${segment}`) || normalised.startsWith(segment)
  );
}

function findSubstringMatch(text: string): string | null {
  for (const pattern of SUBSTRING_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function report(
  context: Deno.lint.RuleContext,
  node: Deno.lint.Node,
  match: string,
): void {
  context.report({
    node,
    message:
      `Hardcoded plugin reference '${match}' — plugin-specific code belongs in packages/plugins/. ` +
      `See docs/code.md → 'No specific plugin references outside plugin code'.`,
  });
}

function checkSubstring(
  context: Deno.lint.RuleContext,
  node: Deno.lint.Node,
  text: string,
): void {
  const match = findSubstringMatch(text);
  if (match) report(context, node, match);
}

function checkIdentifierOrLiteral(
  context: Deno.lint.RuleContext,
  node: Deno.lint.Node,
  text: string,
): void {
  const match = findSubstringMatch(text);
  if (match) {
    report(context, node, match);
    return;
  }
  if (text === "simulated") report(context, node, "simulated");
}

export default {
  name: "custom-plugin-refs",
  rules: {
    "no-plugin-refs": {
      create(context) {
        if (isExcludedFile(context.filename)) return {};
        return {
          Identifier(node: Deno.lint.Identifier) {
            checkIdentifierOrLiteral(context, node, node.name);
          },
          Literal(node: Deno.lint.Literal) {
            if (typeof node.value === "string") {
              checkIdentifierOrLiteral(context, node, node.value);
            }
          },
          TemplateLiteral(node: Deno.lint.TemplateLiteral) {
            for (const quasi of node.quasis) {
              const cooked = (quasi as unknown as { cooked: string }).cooked;
              const match = findSubstringMatch(cooked);
              if (match) {
                report(context, quasi, match);
                return;
              }
            }
          },
          JSXText(node: Deno.lint.JSXText) {
            checkSubstring(context, node, node.value);
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
