/**
 * Keeps a class at the top of its own file: at most a few constants may sit
 * above it. Imports and type-only declarations are unrestricted.
 */

const MAX_PREAMBLE_DECLARATIONS = 3;
const MAX_PREAMBLE_FUNCTIONS = 1;

const isClass = (statement: Deno.lint.Statement): boolean =>
  statement.type === "ClassDeclaration" ||
  (statement.type === "ExportNamedDeclaration" &&
    statement.declaration?.type === "ClassDeclaration");

const isFunction = (statement: Deno.lint.Statement): boolean =>
  statement.type === "FunctionDeclaration" ||
  (statement.type === "ExportNamedDeclaration" &&
    statement.declaration?.type === "FunctionDeclaration");

export default {
  name: "custom-class-first",
  rules: {
    "class-first": {
      create(context: Deno.lint.RuleContext) {
        return {
          Program(node: Deno.lint.Program) {
            const body = node.body.filter((statement) =>
              statement.type !== "ImportDeclaration" &&
              statement.type !== "TSInterfaceDeclaration" &&
              statement.type !== "TSTypeAliasDeclaration"
            );
            const classIndex = body.findIndex(isClass);
            if (classIndex === -1) return;

            const preamble = body.slice(0, classIndex);
            const functions = preamble.filter(isFunction);

            if (preamble.length > MAX_PREAMBLE_DECLARATIONS) {
              context.report({
                node: preamble[MAX_PREAMBLE_DECLARATIONS],
                message:
                  `${preamble.length} declarations sit above the class (max ${MAX_PREAMBLE_DECLARATIONS})`,
                hint:
                  "Move the constants, schemas and helpers into their own module.",
              });
            }
            if (functions.length > MAX_PREAMBLE_FUNCTIONS) {
              context.report({
                node: functions[MAX_PREAMBLE_FUNCTIONS],
                message:
                  `${functions.length} functions sit above the class (max ${MAX_PREAMBLE_FUNCTIONS})`,
                hint: "Move the helpers into their own module.",
              });
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
