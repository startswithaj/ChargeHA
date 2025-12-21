/** Resolves after `ms` milliseconds. Honors fake timers in tests. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
