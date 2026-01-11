import { expect } from "@std/expect";
import plugin from "./no-select-side-effects.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-select-side-effects", async (t) => {
  // Fake filename so the rule's scope check passes
  const filename = "packages/client/src/hooks/useVehicles.ts";
  const lint = (source: string, file = filename) =>
    runPlugin(plugin, source, file);

  await t.step("flags store mutation inside useQuery select", () => {
    const diagnostics = lint(`
      const { data } = trpc.vehicle.list.useQuery(undefined, {
        select: (data) => {
          vehicleErrorStore.setError(data.id, data.error);
          return data.vehicles;
        },
      });
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("setError");
  });

  await t.step("flags store mutation inside arrow-expression select", () => {
    const diagnostics = lint(`
      const { data } = useQuery({
        queryKey: ["foo"],
        queryFn: fetchFoo,
        select: (data) => {
          errorStore.clearError("id");
          return data;
        },
      });
    `);
    expect(diagnostics).toHaveLength(1);
  });

  await t.step("flags bare mutation call inside select", () => {
    const diagnostics = lint(`
      const { data } = trpc.foo.useQuery(undefined, {
        select: (data) => {
          notify();
          return data;
        },
      });
    `);
    expect(diagnostics).toHaveLength(1);
  });

  await t.step("allows pure select with no side effects", () => {
    const diagnostics = lint(`
      const { data } = trpc.vehicle.list.useQuery(undefined, {
        select: (data) => data.vehicles,
      });
    `);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("allows store mutation outside select", () => {
    const diagnostics = lint(`
      vehicleErrorStore.setError("id", "error");
      const { data } = trpc.vehicle.list.useQuery(undefined, {
        select: (data) => data.vehicles,
      });
    `);
    expect(diagnostics).toHaveLength(0);
  });

  await t.step("ignores files outside packages/client/src/", () => {
    const diagnostics = lint(
      `
      const { data } = trpc.vehicle.list.useQuery(undefined, {
        select: (data) => {
          vehicleErrorStore.setError(data.id, data.error);
          return data.vehicles;
        },
      });
      `,
      "packages/server/src/services/foo.ts",
    );
    expect(diagnostics).toHaveLength(0);
  });
});
