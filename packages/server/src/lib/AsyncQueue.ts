/** Async queue for bridging push-based events to pull-based async generators.
 *  Encapsulates the mutable state (buffer + resolver) in one place. */
export function createAsyncQueue<T>() {
  const state: {
    items: T[];
    resolve: (() => void) | null;
  } = {
    items: [],
    resolve: null,
  };

  return {
    push(item: T) {
      state.items.push(item);
      if (state.resolve) {
        state.resolve();
        state.resolve = null;
      }
    },

    async *drain(signal?: AbortSignal): AsyncGenerator<T> {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      while (!signal?.aborted) {
        if (state.items.length === 0) {
          await new Promise<void>((r) => {
            state.resolve = r;
            signal?.addEventListener("abort", () => r(), { once: true });
          });
        }

        // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
        while (state.items.length > 0) {
          const item = state.items.shift();
          if (item === undefined) {
            throw new Error(
              "Queue invariant violated: shift on non-empty array returned undefined",
            );
          }
          yield item;
        }
      }
    },
  };
}
