import { expect } from "@std/expect";
import plugin from "./no-main-trpc.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

const PLUGIN_FILE = "/repo/packages/plugins/vehicles/tesla/client/SomeStep.tsx";
const MAIN_FILE = "/repo/packages/client/src/components/Dashboard.tsx";

Deno.test("no-main-trpc", async (t) => {
  const lint = (source: string, file = PLUGIN_FILE) =>
    runPlugin(plugin, source, file);

  // All expect exactly one diagnostic in a plugin file.
  const flagCases: Array<[string, string]> = [
    ["flags a core router query", `trpc.wizard.tunnelStatus.useQuery();`],
    ["flags a core router via utils", `utils.vehicle.list.invalidate();`],
    [
      "flags a core router via the raw client",
      `utils.client.vehicle.setPriority.mutate({});`,
    ],
    [
      "flags routers that don't exist yet (no deny-list to drift)",
      `trpc.someFutureRouter.thing.useQuery();`,
    ],
    ["flags core router on trpc root", `trpc.health.encryption.useQuery();`],
  ];

  // All expect zero diagnostics.
  const passCases: Array<[string, string, string?]> = [
    [
      "allows the plugin namespace",
      `trpc.plugin.vehicle.tesla.getConfig.useQuery();`,
    ],
    [
      "allows the plugin namespace via utils",
      `utils.plugin.vehicle.tesla.getConfig.invalidate();`,
    ],
    [
      "allows the plugin namespace via the raw client",
      `utils.client.plugin.vehicle.tesla.selectVehicles.mutate({});`,
    ],
    ["allows trpc.useUtils()", `const utils = trpc.useUtils();`],
    [
      "ignores chains not rooted at trpc/utils",
      `someObject.wizard.tunnelStatus();`,
    ],
    [
      "ignores main's own files",
      `trpc.wizard.tunnelStatus.useQuery();`,
      MAIN_FILE,
    ],
    [
      "ignores plugin test files",
      `trpc.wizard.tunnelStatus.useQuery();`,
      "/repo/packages/plugins/vehicles/tesla/client/SomeStep.test.tsx",
    ],
  ];

  for (const [name, source] of flagCases) {
    await t.step(name, () => {
      expect(lint(source).length).toBe(1);
    });
  }

  for (const [name, source, file] of passCases) {
    await t.step(name, () => {
      expect(lint(source, file).length).toBe(0);
    });
  }
});
