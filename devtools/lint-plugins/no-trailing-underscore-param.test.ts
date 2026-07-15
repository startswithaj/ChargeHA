import { expect } from "@std/expect";
import plugin from "./no-trailing-underscore-param.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-trailing-underscore-param", async (t) => {
  const lint = (source: string, file?: string) =>
    runPlugin(plugin, source, file);

  // All expect exactly one diagnostic.
  const flagCases: Array<[string, string]> = [
    [
      "flags unused trailing param on a function declaration",
      `export function TimezoneStep(_props: StepProps) { return null; }`,
    ],
    [
      "flags unused trailing param on an arrow function",
      `const handler = (_event: Event) => done();`,
    ],
    [
      "flags when the trailing param follows used ones",
      `const fn = (a: string, _b: number) => a;`,
    ],
  ];

  // All expect zero diagnostics.
  const passCases: Array<[string, string]> = [
    [
      "allows skipping a middle param to reach a later one",
      `list.map((_item, index) => index);`,
    ],
    [
      "allows normal params",
      `function fn(props: StepProps) { return props; }`,
    ],
    [
      "allows param-less functions",
      `const fn = () => 1;`,
    ],
    [
      "allows class methods mirroring an interface signature",
      `class A { isOnline(_ctx: Ctx): boolean { return true; } }`,
    ],
  ];

  for (const [name, source] of flagCases) {
    await t.step(name, () => {
      expect(lint(source).length).toBe(1);
    });
  }

  for (const [name, source] of passCases) {
    await t.step(name, () => {
      expect(lint(source).length).toBe(0);
    });
  }

  await t.step("ignores test files", () => {
    const diags = lint(
      `const fn = (_props: StepProps) => null;`,
      "/repo/packages/client/src/components/Example.test.tsx",
    );
    expect(diags.length).toBe(0);
  });
});
