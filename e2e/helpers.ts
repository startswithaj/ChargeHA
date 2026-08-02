import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { TapoAppRouter } from "../packages/plugins/chargers/tapo/routerType.ts";

export const APP_URL = Deno.env.get("E2E_APP_URL") ?? "http://localhost:18000";
export const TAPO_CONTROL_URL = Deno.env.get("E2E_TAPO_CONTROL_URL") ??
  "http://localhost:18081";

export const trpc = createTRPCClient<TapoAppRouter>({
  links: [httpBatchLink({ url: `${APP_URL}/trpc` })],
});

/** Poll until the predicate resolves truthy. The only place a retry loop
 *  lives — assertions in tests stay deterministic. Default timeout is 90 s:
 *  the controller loop defaults to 30 s (systemConfigDef), and chained
 *  effects (command → device → next poll) can span two ticks. */
export async function waitFor<T>(
  fn: () => Promise<T | null | false | undefined>,
  { timeoutMs = 90_000, intervalMs = 1_000, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const attempt = async (): Promise<T> => {
    const result = await fn().catch(() => null);
    if (result) return result;
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    return await attempt();
  };
  return await attempt();
}
