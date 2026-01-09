/**
 * Deno lint plugin that enforces a maximum function body length.
 *
 * Scoped to server/src/services/ production code (non-test files).
 * - Production code: 110 lines max
 * - Test files (*.test.ts): 200 lines max, test framework callbacks excluded
 *
 * Counts lines from the opening brace to the closing brace of the function body (inclusive).
 */

const MAX_LINES = 110;
const MAX_LINES_TEST = 200;

/** Test framework functions whose callbacks should be excluded from length checks. */
const TEST_FRAMEWORK_CALLERS = new Set([
  "describe",
  "it",
  "test",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

/** Only enforce in server/src/services/ where refactoring was done. */
function isInScope(filename: string): boolean {
  return filename.includes("packages/server/src/services/") ||
    filename.includes("packages\\server\\src\\services\\");
}

function isTestFile(filename: string): boolean {
  return filename.endsWith(".test.ts") || filename.endsWith(".test.tsx");
}

/**
 * Check if a function node is a direct callback argument to a test framework
 * function like describe(), it(), test(), Deno.test(), etc.
 */
function isTestFrameworkCallback(
  _node:
    | Deno.lint.FunctionDeclaration
    | Deno.lint.FunctionExpression
    | Deno.lint.ArrowFunctionExpression,
  ancestors: Deno.lint.Node[],
): boolean {
  // The parent should be a CallExpression with this function as an argument
  const parent = ancestors[ancestors.length - 1];
  if (!parent || parent.type !== "CallExpression") return false;

  const callee = parent.callee;

  // describe(() => ...), it(() => ...), test(() => ...)
  if (callee.type === "Identifier" && TEST_FRAMEWORK_CALLERS.has(callee.name)) {
    return true;
  }

  // Deno.test(() => ...)
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Deno" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "test"
  ) {
    return true;
  }

  return false;
}

export default {
  name: "custom-function-length",
  rules: {
    "max-function-length": {
      create(context) {
        const isTest = isTestFile(context.filename);
        const limit = isTest ? MAX_LINES_TEST : MAX_LINES;
        const sourceText = context.sourceCode.text;

        function checkFunction(
          node:
            | Deno.lint.FunctionDeclaration
            | Deno.lint.FunctionExpression
            | Deno.lint.ArrowFunctionExpression,
        ) {
          const body = node.body;
          if (!body || body.type !== "BlockStatement") return;

          // Skip test framework callbacks (describe, it, test, Deno.test, etc.)
          if (isTest) {
            const ancestors = context.sourceCode.getAncestors(node);
            if (isTestFrameworkCallback(node, ancestors)) return;
          }

          // Count lines by counting newlines in the body source text
          const bodyText = sourceText.slice(body.range[0], body.range[1]);
          const bodyLines = bodyText.split("\n").length;

          if (bodyLines > limit) {
            const name = "id" in node && node.id?.name
              ? node.id.name
              : "anonymous";
            context.report({
              node,
              message:
                `Function '${name}' is ${bodyLines} lines long (max ${limit}). Break it into smaller functions.`,
            });
          }
        }

        return {
          FunctionDeclaration: checkFunction,
          FunctionExpression: checkFunction,
          ArrowFunctionExpression: checkFunction,
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
