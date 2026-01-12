/**
 * Deno lint plugin that caps test file length.
 *
 * Test files (`*.test.ts`, `*.test.tsx`) over 1000 lines are flagged.
 * Long test files are hard to navigate and usually a sign that the suite
 * should be split by feature/area into separate files.
 */

const MAX_LINES = 1000;

export default {
  name: "custom-test-file-length",
  rules: {
    "test-file-length": {
      create(context) {
        const filename = context.filename;
        if (!filename.includes(".test.")) return {};

        return {
          Program(node: Deno.lint.Program) {
            const lines = context.sourceCode.text.split("\n").length;
            if (lines > MAX_LINES) {
              context.report({
                node,
                message: `Test file is ${lines} lines (max ${MAX_LINES}). ` +
                  `Split into smaller files grouped by feature/area in a ` +
                  `sibling folder, e.g. Foo.test.ts → Foo/charging.test.ts, ` +
                  `Foo/scheduling.test.ts.`,
              });
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
