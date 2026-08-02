import { TAPO_CONTROL_URL } from "./helpers.ts";

export async function tapoControl(
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${TAPO_CONTROL_URL}/set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`tapo control failed: ${res.status}`);
}

export async function tapoState(): Promise<Record<string, unknown>> {
  const res = await fetch(`${TAPO_CONTROL_URL}/state`);
  return await res.json();
}
