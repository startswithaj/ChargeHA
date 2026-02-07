/**
 * Build a stand-in object for type `T` where every property access returns
 * a function that throws a descriptive error when called. An optional
 * overrides object lets tests stub specific methods; anything not in
 * `overrides` throws `"{label}.{prop} was called but not stubbed"`.
 *
 * Use this instead of `{} as T` so that unexpected method calls fail
 * loudly with a clear message instead of "undefined is not a function".
 *
 *     const vm = throwingMock<VehicleManager>("VehicleManager", {
 *       addVehicle: (row) => { registered.push(row); return Promise.resolve(); },
 *     });
 *     // vm.addVehicle(...) runs the stub.
 *     // vm.removeVehicle(...) throws: "VehicleManager.removeVehicle was called but not stubbed".
 */
export function throwingMock<T>(
  label: string,
  overrides: Partial<T> = {},
): T {
  return new Proxy({}, {
    get(_target, prop) {
      const name = String(prop);
      if (name in overrides) {
        return (overrides as Record<string, unknown>)[name];
      }
      return () => {
        throw new Error(`${label}.${name} was called but not stubbed`);
      };
    },
  }) as T;
}
