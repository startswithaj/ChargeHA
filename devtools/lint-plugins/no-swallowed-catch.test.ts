import { expect } from "@std/expect";
import plugin from "./no-swallowed-catch.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-swallowed-catch", async (t) => {
  const lint = (source: string) => runPlugin(plugin, source);

  // All expect exactly one diagnostic.
  const flagCases: Array<[string, string]> = [
    ["flags an empty catch block", `try { work(); } catch {}`],
    [
      "flags an empty catch block with binding",
      `try { work(); } catch (_err) {}`,
    ],
    ["flags an empty .catch() arrow handler", `promise.catch(() => {});`],
    [
      "flags an empty .catch() function handler",
      `promise.catch(function () {});`,
    ],
  ];

  // All expect zero diagnostics.
  const passCases: Array<[string, string]> = [
    [
      "allows a catch block that logs",
      `try { work(); } catch (err) { log(err); }`,
    ],
    [
      "allows a .catch() that logs",
      `promise.catch((err) => { log(err); });`,
    ],
    [
      "allows a .catch() returning a fallback value",
      `const text = await res.text().catch(() => "");`,
    ],
    [
      "allows a .catch() with an expression-body fallback",
      `const json = await res.json().catch(() => null);`,
    ],
    [
      "ignores .catch() with a named handler reference",
      `promise.catch(onError);`,
    ],
    [
      "ignores non-catch member calls with empty arrows",
      `list.forEach(() => {});`,
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
