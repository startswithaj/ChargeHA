import { expect } from "@std/expect";
import plugin from "./no-imperative-loops.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-imperative-loops", async (t) => {
  const lint = (source: string) => runPlugin(plugin, source, "src/example.ts");

  await t.step("flags for loop", () => {
    const diagnostics = lint(
      `for (let i = 0; i < 10; i++) { console.log(i); }`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("for");
  });

  await t.step("flags for...of loop", () => {
    const diagnostics = lint(`for (const x of items) { console.log(x); }`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("for...of");
  });

  await t.step("flags for...in loop", () => {
    const diagnostics = lint(`for (const key in obj) { console.log(key); }`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("for...in");
  });

  await t.step("flags while loop", () => {
    const diagnostics = lint(`while (true) { break; }`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("while");
  });

  await t.step("flags do...while loop", () => {
    const diagnostics = lint(`do { break; } while (true);`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("do...while");
  });

  await t.step("allows .map()", () => {
    const diagnostics = lint(`const y = items.map((x) => x + 1);`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows .forEach()", () => {
    const diagnostics = lint(`items.forEach((x) => console.log(x));`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows .reduce()", () => {
    const diagnostics = lint(`const sum = items.reduce((a, b) => a + b, 0);`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows .filter()", () => {
    const diagnostics = lint(`const evens = items.filter((x) => x % 2 === 0);`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows .flatMap()", () => {
    const diagnostics = lint(`const flat = items.flatMap((x) => [x, x]);`);
    expect(diagnostics).toHaveLength(0);
  });
});
