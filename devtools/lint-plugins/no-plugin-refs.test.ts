import { expect } from "@std/expect";
import plugin from "./no-plugin-refs.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-plugin-refs", async (t) => {
  const filename = "packages/server/src/services/ChargeController.ts";
  const lint = (source: string, file = filename) =>
    runPlugin(plugin, source, file);

  // [name, source, file?] — all expect a diagnostic
  const flagCases: Array<[string, string, string?]> = [
    ["flags tesla in identifier", `const teslaAdapter = null;`],
    ["flags tesla substring case-insensitive", `const Tesla = "foo";`],
    ["flags fronius in string literal", `const adapter = "fronius-local";`],
    ["flags tesla in template string", "const x = `call the tesla api`;"],
    [
      "flags tesla in JSX text",
      `const el = <div>Configure tesla here</div>;`,
      "packages/client/src/components/App.tsx",
    ],
    ["flags exact 'simulated' in string literal", `const type = "simulated";`],
    ["flags exact 'simulated' as identifier name", `const simulated = true;`],
    [
      "flags tesla in import path",
      `import { foo } from "./tesla/adapter.ts";`,
    ],
    [
      "flags tesla in object property key (identifier)",
      `const x = { tesla: 1 };`,
    ],
    [
      "flags tesla in object property key (string)",
      `const x = { "tesla": 1 };`,
    ],
  ];

  // [name, source, file?] — all expect zero diagnostics
  const passCases: Array<[string, string, string?]> = [
    ["allows 'simulatedLoadW' identifier", `const simulatedLoadW = 100;`],
    ["allows 'simulatedLoadW' string literal", `const k = "simulatedLoadW";`],
    [
      "skips files inside packages/plugins/",
      `const teslaAdapter = null;`,
      "packages/plugins/vehicles/tesla/server/index.ts",
    ],
    [
      "skips files inside devtools/",
      `const teslaAdapter = null;`,
      "devtools/sim/cli.ts",
    ],
    [
      "skips files inside packages/shared/simulation/",
      `const teslaAdapter = null;`,
      "packages/shared/simulation/run.ts",
    ],
    [
      "skips test files",
      `const teslaAdapter = null;`,
      "packages/server/src/services/Foo.test.ts",
    ],
    [
      "skips seed files",
      `const teslaAdapter = null;`,
      "packages/server/src/db/seeds/Demo.ts",
    ],
  ];

  for (const [name, source, file] of flagCases) {
    await t.step(name, () => {
      const diags = lint(source, file ?? filename);
      expect(diags.length).toBeGreaterThan(0);
    });
  }

  for (const [name, source, file] of passCases) {
    await t.step(name, () => {
      const diags = lint(source, file ?? filename);
      expect(diags).toHaveLength(0);
    });
  }
});
