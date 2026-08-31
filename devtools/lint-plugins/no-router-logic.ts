const MAX_HANDLER_LINES = 15;

// The head of a builder chain: publicProcedure, protectedProcedure, …
const PROCEDURE_CHAIN = /^[a-zA-Z]*[Pp]rocedure\b/;

const HANDLERS = new Set(["query", "mutation", "subscription"]);

const SELF_BARREL = /^\.\.?\/index\.ts$/;

// Measure the size of the procedure body.
function handlerBody(node: Deno.lint.Node): Deno.lint.Node | null {
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier" &&
    HANDLERS.has(node.callee.property.name)
  ) {
    return node.arguments[0] ?? null;
  }
  return Object.entries(node)
    .filter(([key]) => key !== "parent")
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((child): child is Deno.lint.Node =>
      Boolean(child) && typeof child === "object" && "type" in child
    )
    .reduce<Deno.lint.Node | null>(
      (found, child) => found ?? handlerBody(child),
      null,
    );
}

function codeLines(source: string): number {
  return source.split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//")).length;
}

function isRouterFile(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  if (normalised.includes(".test.")) return false;
  if (normalised.includes("packages/server/src/trpc/routers/")) return true;
  return normalised.includes("packages/plugins/") &&
    /(^|\/)([A-Za-z]*[Rr]outer)\.ts$/.test(normalised);
}

export default {
  name: "custom-router-logic",
  rules: {
    "no-router-logic": {
      create(context) {
        if (!isRouterFile(context.filename)) return {};

        const text = context.sourceCode.text;

        const reportBarrel = (node: Deno.lint.Node, specifier: string) => {
          if (!SELF_BARREL.test(specifier)) return;
          context.report({
            node,
            message:
              "Importing index.ts creates a cycle: index.ts imports this " +
              "router. Import the class from its own file instead, e.g. " +
              '`import type { GoodweSemsPlugin } from "./GoodweSemsPlugin.ts"`.',
          });
        };

        return {
          Property(node: Deno.lint.Property) {
            const value = text.slice(node.value.range[0], node.value.range[1]);
            if (!PROCEDURE_CHAIN.test(value)) return;
            const body = handlerBody(node.value);
            if (!body) return;
            const lines = codeLines(
              text.slice(body.range[0], body.range[1]),
            );
            if (lines <= MAX_HANDLER_LINES) return;
            const name = node.key.type === "Identifier"
              ? node.key.name
              : "procedure";
            context.report({
              node: body,
              message: `\`${name}\` has a ${lines}-line handler (max ` +
                `${MAX_HANDLER_LINES}). A procedure validates input, calls ` +
                `one method, and returns the result. Move the work onto the ` +
                `plugin or a service.`,
            });
          },
          ImportDeclaration(node: Deno.lint.ImportDeclaration) {
            reportBarrel(node.source, String(node.source.value));
          },
          // A re-export reaches index.ts just as directly as an import.
          ExportNamedDeclaration(node: Deno.lint.ExportNamedDeclaration) {
            if (node.source) {
              reportBarrel(node.source, String(node.source.value));
            }
          },
          ExportAllDeclaration(node: Deno.lint.ExportAllDeclaration) {
            if (node.source) {
              reportBarrel(node.source, String(node.source.value));
            }
          },
          ImportExpression(node: Deno.lint.ImportExpression) {
            if (node.source.type !== "Literal") return;
            reportBarrel(node.source, String(node.source.value));
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
