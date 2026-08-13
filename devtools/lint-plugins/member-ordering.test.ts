import { expect } from "@std/expect";
import plugin from "./member-ordering.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("member-ordering", async (t) => {
  const lint = (source: string) => runPlugin(plugin, source);

  // All expect exactly one diagnostic.
  const flagCases: Array<[string, string]> = [
    [
      "flags a field declared after a method",
      `class A { run(): void {} private cache = 1; }`,
    ],
    [
      "flags a field declared after the constructor",
      `class A { constructor() {} private cache: number | null = null; }`,
    ],
    [
      "flags a field between methods",
      `class A { first(): void {} count = 0; second(): void {} }`,
    ],
  ];

  // All expect zero diagnostics.
  const passCases: Array<[string, string]> = [
    [
      "allows fields at the top of the class",
      `class A { private cache = 1; constructor() {} run(): void {} }`,
    ],
    [
      "allows a class with only fields",
      `class A { one = 1; two = 2; }`,
    ],
    [
      "allows a class with only methods",
      `class A { run(): void {} stop(): void {} }`,
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
});
