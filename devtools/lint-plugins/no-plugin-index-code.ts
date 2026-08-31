const DECLARATIONS: Record<string, string> = {
  ClassDeclaration: "class",
  FunctionDeclaration: "function",
  VariableDeclaration: "const",
  TSInterfaceDeclaration: "interface",
  TSTypeAliasDeclaration: "type",
  TSEnumDeclaration: "enum",
  TSModuleDeclaration: "namespace",
};

function isPluginBarrel(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  if (normalised.includes(".test.")) return false;
  return normalised.includes("packages/plugins/") &&
    normalised.endsWith("/index.ts");
}

export default {
  name: "custom-plugin-index-code",
  rules: {
    "no-plugin-index-code": {
      create(context) {
        if (!isPluginBarrel(context.filename)) return {};

        return {
          Program(node: Deno.lint.Program) {
            node.body.forEach((statement) => {
              // `export class Foo {}` wraps the declaration one level down.
              const declared = (statement.type === "ExportNamedDeclaration" ||
                  statement.type === "ExportDefaultDeclaration")
                ? statement.declaration
                : statement;
              if (!declared) return;
              const kind = DECLARATIONS[declared.type];
              if (!kind) return;
              context.report({
                node: declared,
                message:
                  `index.ts declares a ${kind}. A plugin's index.ts may only ` +
                  `re-export. Move the ${kind} to a file named after it, e.g. ` +
                  `GoodweSemsPlugin.ts, then export it from here.`,
              });
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
