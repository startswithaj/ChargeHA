import { expect } from "@std/expect";
import plugin from "./expression-complexity.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-nested-ternary", async (t) => {
  const lint = (source: string, filename?: string) =>
    runPlugin(plugin, source, filename);

  await t.step("allows simple single-line ternary", () => {
    const diagnostics = lint(`const x = a ? b : c;`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("catches nested ternary in consequent", () => {
    const diagnostics = lint(`const x = a ? (b ? c : d) : e;`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("consequent");
  });

  await t.step("catches nested ternary in alternate", () => {
    const diagnostics = lint(`const x = a ? b : (c ? d : e);`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("alternate");
  });

  await t.step("catches nested ternary in both branches", () => {
    const diagnostics = lint(`const x = a ? (b ? c : d) : (e ? f : g);`);
    expect(diagnostics).toHaveLength(2);
  });

  await t.step("catches nested ternary in any file", () => {
    const diagnostics = lint(
      `const x = a ? (b ? c : d) : e;`,
      "packages/client/src/App.tsx",
    );
    expect(diagnostics).toHaveLength(1);
  });
});

Deno.test("no-multiline-ternary", async (t) => {
  const lint = (source: string, filename?: string) =>
    runPlugin(plugin, source, filename);

  await t.step("allows single-line ternary", () => {
    const diagnostics = lint(`const x = a ? b : c;`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows ternary wrapped to 3 lines by formatter", () => {
    const source = [
      "const x = someCondition",
      "  ? consequentValue",
      "  : alternateValue;",
    ].join("\n");
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("catches ternary spanning 4+ lines", () => {
    const source = [
      "const x = someCondition",
      "  ? someReallyLongConsequentValue +",
      "    moreStuff",
      "  : alternateValue;",
    ].join("\n");
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("4 lines");
    expect(diagnostics[0].message).toContain("max 3");
  });
});

Deno.test("no-multiline-boolean", async (t) => {
  const lint = (source: string, filename?: string) =>
    runPlugin(plugin, source, filename);

  await t.step("allows simple single-line boolean", () => {
    const diagnostics = lint(`const x = a && b;`);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows boolean on 2 lines", () => {
    const source = [
      "const x = a &&",
      "  b;",
    ].join("\n");
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("catches boolean expression spanning 3+ lines", () => {
    const source = [
      "const x = a &&",
      "  b &&",
      "  c;",
    ].join("\n");
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("3 lines");
    expect(diagnostics[0].message).toContain("max 2");
    expect(diagnostics[0].message).toContain("x");
  });

  await t.step("catches || expressions too", () => {
    const source = [
      "const y = a ||",
      "  b ||",
      "  c;",
    ].join("\n");
    const diagnostics = lint(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("y");
  });

  await t.step(
    "does not flag logical expressions outside variable declarations",
    () => {
      const source = [
        "if (a &&",
        "    b &&",
        "    c) {}",
      ].join("\n");
      const diagnostics = lint(source);
      expect(diagnostics).toHaveLength(0);
    },
  );
});
