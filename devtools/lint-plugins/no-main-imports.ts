/**
 * Deno lint plugin: plugin code may not deep-import main's client internals.
 * The host UI surface plugins may consume is `packages/plugins/hostUi.ts` —
 * the client-side counterpart of PluginDependencies. Main can refactor
 * anything in client/src freely as long as the barrel keeps its contracts.
 *
 * Only files under packages/plugins/ are checked; test files are excluded
 * (they legitimately deep-import test helpers).
 */

function isPluginFile(filename: string): boolean {
  const normalised = filename.replace(/\\/g, "/");
  if (normalised.endsWith(".test.ts") || normalised.endsWith(".test.tsx")) {
    return false;
  }
  return normalised.includes("/packages/plugins/");
}

export default {
  name: "custom-main-imports",
  rules: {
    "no-main-imports": {
      create(context) {
        const normalised = context.filename.replace(/\\/g, "/");
        if (!isPluginFile(normalised)) return {};
        if (normalised.endsWith("/packages/plugins/hostUi.ts")) return {};
        return {
          ImportDeclaration(node: Deno.lint.ImportDeclaration) {
            const source = String(node.source.value);
            if (!source.includes("client/src/")) return;
            context.report({
              node: node.source,
              message:
                "Plugin code must not deep-import main's client internals — import the host UI surface " +
                "from packages/plugins/hostUi.ts (add the export there if it's missing).",
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
