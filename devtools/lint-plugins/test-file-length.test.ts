import { expect } from "@std/expect";
import plugin from "./test-file-length.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("test-file-length", async (t) => {
  const lintTest = (source: string) =>
    runPlugin(plugin, source, "src/example.test.ts");
  const lintNonTest = (source: string) =>
    runPlugin(plugin, source, "src/example.ts");

  await t.step("allows file under 1000 lines", () => {
    const source = "// line\n".repeat(500);
    const diagnostics = lintTest(source);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows file at exactly 1000 lines", () => {
    const source = "// line\n".repeat(999) + "// last";
    const diagnostics = lintTest(source);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("flags file over 1000 lines", () => {
    const source = "// line\n".repeat(1001);
    const diagnostics = lintTest(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/Test file is \d+ lines/);
    expect(diagnostics[0].message).toContain("max 1000");
  });

  await t.step("ignores non-test files over 1000 lines", () => {
    const source = "// line\n".repeat(2000);
    const diagnostics = lintNonTest(source);
    expect(diagnostics).toHaveLength(0);
  });
});
