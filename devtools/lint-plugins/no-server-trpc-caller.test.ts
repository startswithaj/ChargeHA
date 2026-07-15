import { expect } from "@std/expect";
import plugin from "./no-server-trpc-caller.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-server-trpc-caller", async (t) => {
  const source = `
    import { createCallerFactory } from "../trpc/trpc.ts";
    const caller = createCallerFactory(router)(ctx);
  `;

  await t.step("flags createCallerFactory in server code", () => {
    const diags = runPlugin(
      plugin,
      source,
      "/repo/packages/server/src/services/VehicleService.ts",
    );
    // Import + call site both mention the identifier.
    expect(diags.length).toBeGreaterThan(0);
  });

  await t.step("allows it in the trpc setup directory", () => {
    const diags = runPlugin(
      plugin,
      `export const createCallerFactory = t.createCallerFactory;`,
      "/repo/packages/server/src/trpc/trpc.ts",
    );
    expect(diags.length).toBe(0);
  });

  await t.step("allows it in test files", () => {
    const diags = runPlugin(
      plugin,
      source,
      "/repo/packages/plugins/vehicles/tesla/server/router.test.ts",
    );
    expect(diags.length).toBe(0);
  });

  await t.step("ignores unrelated identifiers", () => {
    const diags = runPlugin(
      plugin,
      `const createCaller = factory(router);`,
      "/repo/packages/server/src/services/VehicleService.ts",
    );
    expect(diags.length).toBe(0);
  });
});
