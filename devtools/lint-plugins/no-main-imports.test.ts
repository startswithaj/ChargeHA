import { expect } from "@std/expect";
import plugin from "./no-main-imports.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

const PLUGIN_FILE = "/repo/packages/plugins/vehicles/tesla/client/SomeStep.tsx";
const MAIN_FILE = "/repo/packages/client/src/components/Dashboard.tsx";

Deno.test("no-main-imports", async (t) => {
  const lint = (source: string, file = PLUGIN_FILE) =>
    runPlugin(plugin, source, file);

  await t.step("flags deep imports into main's client", () => {
    const diags = lint(
      `import { Spinner } from "../../../../client/src/components/ui/Spinner.tsx";`,
    );
    expect(diags.length).toBe(1);
  });

  // Re-exports and dynamic imports reach main just as directly as a static import.
  await t.step("flags named re-exports of main's client", () => {
    const diags = lint(
      `export { Spinner } from "../../../../client/src/components/ui/Spinner.tsx";`,
    );
    expect(diags.length).toBe(1);
  });

  await t.step("flags star re-exports of main's client", () => {
    const diags = lint(`export * from "../../../../client/src/trpc.ts";`);
    expect(diags.length).toBe(1);
  });

  await t.step("flags dynamic imports of main's client", () => {
    const diags = lint(
      `const load = () => import("../../../../client/src/trpc.ts");`,
    );
    expect(diags.length).toBe(1);
  });

  await t.step("ignores re-exports that stay inside the plugin", () => {
    expect(lint(`export { helper } from "./helper.ts";`).length).toBe(0);
  });

  await t.step("allows importing through the hostUi barrel", () => {
    expect(lint(`import { Spinner } from "../../../hostUi.ts";`).length)
      .toBe(0);
  });

  await t.step("allows the barrel itself to import client/src", () => {
    const diags = lint(
      `export { Spinner } from "../client/src/components/ui/Spinner.tsx";
       import { X } from "../client/src/trpc.ts";`,
      "/repo/packages/plugins/hostUi.ts",
    );
    expect(diags.length).toBe(0);
  });

  await t.step("ignores main's own files", () => {
    const diags = lint(
      `import { Spinner } from "../../client/src/components/ui/Spinner.tsx";`,
      MAIN_FILE,
    );
    expect(diags.length).toBe(0);
  });

  await t.step("ignores plugin test files", () => {
    const diags = lint(
      `import { X } from "../../../../client/src/test-utils.tsx";`,
      "/repo/packages/plugins/vehicles/tesla/client/SomeStep.test.tsx",
    );
    expect(diags.length).toBe(0);
  });
});
