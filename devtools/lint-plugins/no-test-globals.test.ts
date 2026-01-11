import { expect } from "@std/expect";
import plugin from "./no-test-globals.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-test-globals", async (t) => {
  const lintTest = (source: string) =>
    runPlugin(plugin, source, "src/example.test.ts");
  const lintNonTest = (source: string) =>
    runPlugin(plugin, source, "src/example.ts");

  await t.step("flags module-level const in test file", () => {
    const diagnostics = lintTest(`const FOO = 1;`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("'const' declaration");
  });

  await t.step("flags module-level let in test file", () => {
    const diagnostics = lintTest(`let foo = 1;`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("'let' declaration");
  });

  await t.step("flags module-level function in test file", () => {
    const diagnostics = lintTest(`function helper() { return 1; }`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("function declaration");
  });

  await t.step("allows module-level class declaration in test file", () => {
    const diagnostics = lintTest(`class Mock {}`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("flags class declaration inside describe", () => {
    const diagnostics = lintTest(
      `describe("x", () => { class Mock {} });`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain(
      "belong at module scope",
    );
  });

  await t.step("allows module-level type alias in test file", () => {
    const diagnostics = lintTest(`type Foo = number;`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows module-level interface in test file", () => {
    const diagnostics = lintTest(`interface Foo { x: number }`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows module-level enum in test file", () => {
    const diagnostics = lintTest(`enum Foo { A, B }`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("flags underscore-prefixed let inside describe", () => {
    const diagnostics = lintTest(
      `describe("x", () => { let _sut: number; });`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Underscore-prefixed");
  });

  await t.step("allows imports at module level", () => {
    const diagnostics = lintTest(
      `import { foo } from "./x.ts";\ndescribe("x", () => {});`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows decls inside describe callback", () => {
    const diagnostics = lintTest(
      `describe("x", () => {
        const FOO = 1;
        let bar = 2;
        function helper() {}
        type T = number;
        interface I { x: number }
      });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("ignores non-test files", () => {
    const diagnostics = lintNonTest(
      `const FOO = 1;
       let bar = 2;
       function helper() {}
       class Mock {}
       type T = number;`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("flags multiple module-level decls", () => {
    const diagnostics = lintTest(`const a = 1; const b = 2; let c = 3;`);
    expect(diagnostics).toHaveLength(3);
  });

  await t.step("allows const x = vi.hoisted(...) at module level", () => {
    const diagnostics = lintTest(
      `const mocks = vi.hoisted(() => ({ x: vi.fn() }));`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("flags bare module-level vi.fn()", () => {
    const diagnostics = lintTest(`const x = vi.fn();`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("'const' declaration");
  });

  await t.step("flags non-hoisted call masquerading as escape hatch", () => {
    const diagnostics = lintTest(`const x = something.hoisted(() => ({}));`);
    expect(diagnostics).toHaveLength(1);
  });
});
