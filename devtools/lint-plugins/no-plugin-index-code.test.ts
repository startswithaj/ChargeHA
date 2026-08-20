import { expect } from "@std/expect";
import plugin from "./no-plugin-index-code.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

const BARREL = "packages/plugins/energy/goodwe-sems/server/index.ts";
const CLASS_FILE =
  "packages/plugins/energy/goodwe-sems/server/GoodweSemsPlugin.ts";

Deno.test("no-plugin-index-code", async (t) => {
  const lint = (source: string, file = BARREL) =>
    runPlugin(plugin, source, file);

  await t.step("flags an exported class", () => {
    const diags = lint(`export class GoodweSemsPlugin {}`);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("class");
  });

  await t.step("flags a non-exported declaration too", () => {
    expect(lint(`const DEFAULT_PORT = 8000;`).length).toBe(1);
  });

  await t.step("flags a type alias", () => {
    expect(lint(`export type SemsUiResult = { ok: boolean };`).length).toBe(1);
  });

  await t.step("flags a function and an interface", () => {
    const diags = lint(
      `export function make() {}
       interface Shape { a: string }`,
    );
    expect(diags.length).toBe(2);
  });

  await t.step("allows star re-exports", () => {
    expect(lint(`export * from "./GoodweSemsPlugin.ts";`).length).toBe(0);
  });

  await t.step("allows named and type re-exports", () => {
    const diags = lint(
      `export { GoodweSemsPlugin } from "./GoodweSemsPlugin.ts";
       export type { SemsUiResult } from "./types.ts";
       export type * from "./types.ts";`,
    );
    expect(diags.length).toBe(0);
  });

  await t.step("ignores a plugin file that is not index.ts", () => {
    expect(lint(`export class GoodweSemsPlugin {}`, CLASS_FILE).length).toBe(0);
  });

  await t.step("ignores index.ts outside packages/plugins", () => {
    const diags = lint(
      `export class Thing {}`,
      "packages/client/src/components/index.ts",
    );
    expect(diags.length).toBe(0);
  });
});
