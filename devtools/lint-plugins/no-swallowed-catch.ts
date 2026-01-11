/**
 * Deno lint plugin that disallows catch blocks that swallow errors.
 *
 * A catch block must do something meaningful with the error — log it, rethrow it,
 * or assign it. Catch blocks that are empty or only contain comments are flagged.
 */

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
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
