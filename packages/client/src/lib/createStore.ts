/** Generic external store atom for use with useSyncExternalStore.
 *  Encapsulates the single mutable reference — consumers are pure. */
export function createStore<T>(initial: T) {
  // encapsulated mutable atom for useSyncExternalStore
  // deno-lint-ignore custom-no-let/no-let
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    setState(next: T) {
      if (next === current) return;
      current = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
