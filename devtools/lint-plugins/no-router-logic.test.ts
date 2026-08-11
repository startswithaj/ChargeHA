import { expect } from "@std/expect";
import plugin from "./no-router-logic.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

const PLUGIN_ROUTER = "packages/plugins/energy/goodwe-sems/server/router.ts";
const CORE_ROUTER = "packages/server/src/trpc/routers/energy.ts";
const SERVICE = "packages/server/src/services/EnergyService.ts";

const wrap = (body: string) => `export const r = router({\n${body}\n});`;

const procedure = (bodyLines: number) =>
  wrap(
    `  updateState: publicProcedure
    .input(schema)
    .mutation(async ({ input }) => {
${"      doThing(input);\n".repeat(bodyLines)}    }),`,
  );

Deno.test("no-router-logic", async (t) => {
  const lint = (source: string, file = PLUGIN_ROUTER) =>
    runPlugin(plugin, source, file);

  await t.step("allows a handler at the cap", () => {
    expect(lint(procedure(13)).length).toBe(0);
  });

  await t.step("flags a handler over the cap", () => {
    const diags = lint(procedure(40));
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("`updateState` has a 42-line handler");
  });

  // Comments and blanks are documentation, not logic.
  await t.step("does not count comments or blank lines", () => {
    const diags = lint(
      wrap(
        `  status: publicProcedure.query(() => {
${"      // an explanation of why\n\n".repeat(30)}      return plugin.status();
    }),`,
      ),
    );
    expect(diags.length).toBe(0);
  });

  // A long input schema in front of a one-line delegation is not logic.
  await t.step("does not count the input schema", () => {
    const diags = lint(
      wrap(
        `  changeMode: publicProcedure
    .input(z.object({
${"      field: z.string(),\n".repeat(40)}    }))
    .mutation(({ input }) => ctx.authService.handleChangeMode(input)),`,
      ),
    );
    expect(diags.length).toBe(0);
  });

  await t.step("flags each oversized handler separately", () => {
    const diags = lint(
      wrap(
        `  a: publicProcedure.mutation(() => {\n${"    x();\n".repeat(25)}  }),
  b: publicProcedure.query(() => plugin.list()),
  c: protectedProcedure.subscription(() => {\n${"    y();\n".repeat(25)}  }),`,
      ),
    );
    expect(diags.length).toBe(2);
  });

  await t.step("measures handlers in core routers too", () => {
    expect(lint(procedure(40), CORE_ROUTER).length).toBe(1);
  });

  await t.step("ignores object properties that are not procedures", () => {
    expect(lint(wrap(`  helpers: {\n${"    a: 1,\n".repeat(40)}  },`)).length)
      .toBe(0);
  });

  await t.step("flags importing the plugin class from index.ts", () => {
    const diags = lint(`import type { GoodweSemsPlugin } from "./index.ts";`);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain("creates a cycle");
  });

  // A re-export or dynamic import reaches index.ts just as directly.
  await t.step("flags re-exports and dynamic imports of index.ts", () => {
    const diags = lint(
      `export * from "./index.ts";
       const load = () => import("../index.ts");`,
    );
    expect(diags.length).toBe(2);
  });

  await t.step("allows ordinary router wiring", () => {
    const diags = lint(
      `import { z } from "zod";
       import type { GoodweSemsPlugin } from "./GoodweSemsPlugin.ts";
       export const r = router({
         listStations: publicProcedure
           .input(credentialsInput)
           .mutation(({ input }) => plugin.listStations(input.account)),
       });`,
    );
    expect(diags.length).toBe(0);
  });

  await t.step("ignores non-router files", () => {
    expect(lint(procedure(40), SERVICE).length).toBe(0);
  });

  await t.step("ignores router test files", () => {
    const diags = lint(
      `import { TeslaVehiclePlugin } from "./index.ts";`,
      "packages/plugins/vehicles/tesla/server/router.test.ts",
    );
    expect(diags.length).toBe(0);
  });
});
