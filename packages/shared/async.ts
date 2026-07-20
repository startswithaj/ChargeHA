/** Resolves after `ms` milliseconds. Honors fake timers in tests. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` over `items` one at a time, awaiting each before the next.
 *  Use instead of Promise.all when the operations must not interleave. */
export async function inSequence<T>(
  items: readonly T[],
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  await items.reduce(
    (chain, item) => chain.then(() => fn(item)),
    Promise.resolve() as Promise<unknown>,
  );
}
