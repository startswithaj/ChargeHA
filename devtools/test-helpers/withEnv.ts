export async function withEnv(
  name: string,
  value: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  const original = Deno.env.get(name);
  Deno.env.set(name, value);
  try {
    await fn();
  } finally {
    if (original !== undefined) {
      Deno.env.set(name, original);
    } else {
      Deno.env.delete(name);
    }
  }
}
