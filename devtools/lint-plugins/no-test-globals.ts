/**
 * Deno lint plugin for test-file hygiene.
 *
 * Allowed at module scope in `*.test.ts` / `*.test.tsx`:
 *   - imports
 *   - `type` / `interface` aliases, `enum` declarations
 *   - `class` declarations (their shape is immutable; instances are made
 *     fresh per test inside `beforeEach`)
 *   - `vi.mock(...)` calls
 *   - `const <name> = vi.hoisted(() => ({ ... }))` — vitest's escape hatch
 *     for `vi.mock()` factories that need `vi.fn()` values
 *
 * Banned at module scope: `let`, `const` (non-hoisted), `function`. They must
 * live inside a `describe` block (or its setup callbacks) so each suite gets
 * fresh state.
 *
 * Class declarations are allowed at module scope but BANNED inside a
 * `describe` / `it` / `beforeEach` callback — declaring a class inline is
 * noise; lift it to module scope (or a separate helper file) where it
 * belongs.
 *
 * Underscore-prefixed `let _x` / `const _x` bindings are banned. If a
 * binding is unused, drop the assignment (`new X(...)` for side effect
 * only). Marking it `_` to silence `no-unused-vars` hides intent.
 *
 * Do NOT extract shared mocks to a `*Mocks.ts` / `*Harness.ts` helper file
 * just to satisfy this rule. That's the same shared mutable state hidden
 * behind an import — the rule's intent is "no shared singletons", regardless
 * of where they live.
 */

function isViHoistedCall(init: Deno.lint.Expression | null | undefined) {
  return init?.type === "CallExpression" &&
    init.callee.type === "MemberExpression" &&
    init.callee.object.type === "Identifier" &&
    init.callee.object.name === "vi" &&
    init.callee.property.type === "Identifier" &&
    init.callee.property.name === "hoisted";
}

export default {
  name: "custom-no-test-globals",
  rules: {
    "no-test-globals": {
      create(context) {
        const filename = context.filename;
        if (!filename.includes(".test.")) return {};

        function flag(node: Deno.lint.Node, kind: string) {
          context.report({
            node,
            message: `Module-level ${kind} not allowed in test files. ` +
              `Move it inside the describe(...) callback. The only ` +
              `module-level escape hatch is ` +
              `\`const mocks = vi.hoisted(() => ({...}))\`.`,
          });
        }

        return {
          "Program > VariableDeclaration"(
            node: Deno.lint.VariableDeclaration,
          ) {
            // Allow `const x = vi.hoisted(...)` — vitest hoists this before
            // vi.mock() factories run, so factories can reference its return
            // value. This is the only sanctioned module-level mutable state.
            const allHoisted = node.declarations.every((d) =>
              isViHoistedCall(d.init)
            );
            if (allHoisted) return;
            flag(node, `'${node.kind}' declaration`);
          },
          "Program > FunctionDeclaration"(
            node: Deno.lint.FunctionDeclaration,
          ) {
            flag(node, "function declaration");
          },
          // Classes are allowed at module scope but NOT inside describe/it/
          // setup callbacks. Match any ClassDeclaration whose direct parent
          // is not the Program root.
          ":not(Program) > ClassDeclaration"(
            node: Deno.lint.ClassDeclaration,
          ) {
            context.report({
              node,
              message:
                "Class declarations belong at module scope in test files, " +
                "not inside a describe/it/beforeEach callback. Move it " +
                "above the describe(...) call (or extract to a helper file).",
            });
          },
          // Underscore-prefixed `let _x` / `const _x` — flag everywhere.
          // If unused, drop the binding; if used for a side effect, call
          // the constructor/function without assigning.
          VariableDeclarator(node: Deno.lint.VariableDeclarator) {
            if (
              node.id.type === "Identifier" && node.id.name.startsWith("_")
            ) {
              context.report({
                node: node.id,
                message:
                  `Underscore-prefixed binding '${node.id.name}' in test ` +
                  "file. If unused, drop the binding. If used for a side " +
                  "effect, call the constructor/function without assigning.",
              });
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
