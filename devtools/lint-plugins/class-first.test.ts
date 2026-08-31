import { expect } from "@std/expect";
import plugin from "./class-first.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

const FILE = "packages/plugins/energy/goodwe-sems/server/Thing.ts";

Deno.test("class-first", async (t) => {
  const lint = (source: string) => runPlugin(plugin, source, FILE);

  await t.step("allows a class with no preamble", () => {
    expect(lint(`export class Thing {}`).length).toBe(0);
  });

  await t.step("allows a few constants above the class", () => {
    const diags = lint(
      `const A = 1;
       const B = 2;
       const C = 3;
       export class Thing {}`,
    );
    expect(diags.length).toBe(0);
  });

  await t.step("flags a fourth declaration above the class", () => {
    const diags = lint(
      `const A = 1;
       const B = 2;
       const C = 3;
       const D = 4;
       export class Thing {}`,
    );
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("declarations sit above the class");
  });

  await t.step("allows one helper above the class", () => {
    expect(lint(`function help() {}\nexport class Thing {}`).length).toBe(0);
  });

  await t.step("flags a second helper above the class", () => {
    const diags = lint(
      `function a() {}
       function b() {}
       export class Thing {}`,
    );
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("functions sit above the class");
  });

  await t.step("ignores imports and type-only declarations", () => {
    const diags = lint(
      `import { a } from "./a.ts";
       import { b } from "./b.ts";
       import { c } from "./c.ts";
       import { d } from "./d.ts";
       interface Shape { a: string }
       type Other = { b: string };
       export class Thing { run() { return a + b + c + d; } }`,
    );
    expect(diags.length).toBe(0);
  });

  await t.step("ignores files with no class", () => {
    const diags = lint(
      `const A = 1;
       const B = 2;
       const C = 3;
       const D = 4;
       export function make() {}`,
    );
    expect(diags.length).toBe(0);
  });

  await t.step("ignores declarations below the class", () => {
    const diags = lint(
      `export class Thing {}
       const A = 1;
       const B = 2;
       const C = 3;
       const D = 4;`,
    );
    expect(diags.length).toBe(0);
  });
});
