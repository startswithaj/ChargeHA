import { expect } from "@std/expect";
import plugin from "./function-length.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("max-function-length", async (t) => {
  const lint = (source: string, filename?: string) =>
    runPlugin(plugin, source, filename);

  // Build a body of N `const xN = N;` lines, with optional indentation.
  const makeFunctionBody = (lines: number, indent = "  ") =>
    Array.from({ length: lines }, (_, i) => `${indent}const x${i} = ${i};`)
      .join("\n");

  await t.step("allows short functions", () => {
    const diagnostics = lint(`
function short() {
  return 1;
}
`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows functions at exactly 100 lines", () => {
    // 100 lines: opening brace + 98 body lines + closing brace
    const source = `function atLimit() {\n${makeFunctionBody(98)}\n}`;
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("flags functions over 110 lines", () => {
    // 112 lines: opening brace + 110 body lines + closing brace
    const source = `function tooLong() {\n${makeFunctionBody(110)}\n}`;
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("tooLong");
    expect(diagnostics[0].message).toContain("112 lines");
    expect(diagnostics[0].message).toContain("max 110");
  });

  await t.step("flags arrow functions over 110 lines", () => {
    const source = `const tooLong = () => {\n${makeFunctionBody(110)}\n};`;
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("anonymous");
  });

  await t.step("flags function expressions over 110 lines", () => {
    const source = `const tooLong = function namedExpr() {\n${
      makeFunctionBody(110)
    }\n};`;
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("namedExpr");
  });

  await t.step("flags method definitions over 110 lines", () => {
    const source = `class Foo {\n  longMethod() {\n${
      makeFunctionBody(110, "    ")
    }\n  }\n}`;
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("anonymous");
  });

  await t.step("skips arrow functions without block body", () => {
    const diagnostics = lint(`const fn = () => 42;`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("uses 200-line limit for test files", () => {
    // 150 lines — exceeds 100 but under 200
    const source = `function longTestHelper() {\n${makeFunctionBody(148)}\n}`;
    const diagnostics = lint(
      source,
      "packages/server/src/services/Example.test.ts",
    );
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("flags test functions over 200 lines", () => {
    const source = `function tooLongTest() {\n${makeFunctionBody(200)}\n}`;
    const diagnostics = lint(
      source,
      "packages/server/src/services/Example.test.ts",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("max 200");
  });

  await t.step("skips describe() callbacks in test files", () => {
    // 300 lines in a describe callback — should be skipped
    const source =
      `import { describe } from "jsr:@std/testing";\ndescribe("suite", () => {\n${
        makeFunctionBody(298)
      }\n});`;
    const diagnostics = lint(
      source,
      "packages/server/src/services/Example.test.ts",
    );
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("skips Deno.test() callbacks in test files", () => {
    const source = `Deno.test("test", () => {\n${makeFunctionBody(298)}\n});`;
    const diagnostics = lint(
      source,
      "packages/server/src/services/Example.test.ts",
    );
    expect(diagnostics).toHaveLength(0);
  });

  await t.step(
    "applies to files outside packages/server/src/services/",
    () => {
      const source = `function veryLong() {\n${makeFunctionBody(200)}\n}`;
      const diagnostics = lint(source, "packages/client/src/App.tsx");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain("max 110");
    },
  );
});
