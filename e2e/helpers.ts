import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { TapoAppRouter } from "../packages/plugins/chargers/tapo/routerType.ts";

export const APP_URL = Deno.env.get("E2E_APP_URL") ?? "http://localhost:18000";
export const TAPO_CONTROL_URL = Deno.env.get("E2E_TAPO_CONTROL_URL") ??
  "http://localhost:18081";

export const trpc = createTRPCClient<TapoAppRouter>({
  links: [httpBatchLink({ url: `${APP_URL}/trpc` })],
});

// Restart the app container and wait for it to serve again. A real restart, not mocked:
// OCPP is charger-initiated, so only the charger dialling back in restores the socket —
// the container's filesystem survives, so the database and charger rows persist too.
export async function restartApp(): Promise<void> {
  const restart = await new Deno.Command("docker", {
    args: [
      "compose",
      "-f",
      "docker/docker-compose.e2e.yml",
      "restart",
      "app",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!restart.success) {
    throw new Error(
      `docker compose restart app failed: ${
        new TextDecoder().decode(restart.stderr)
      }`,
    );
  }
  // The container reports healthy before tRPC is necessarily answering, so
  // wait on a real query rather than on docker's own health state.
  await waitFor(
    () => trpc.charger.list.query().then(() => true).catch(() => null),
    { timeoutMs: 60_000, intervalMs: 1_000, label: "app back after restart" },
  );
}

// The only retry loop — assertions in tests stay deterministic. Default 90s: controller
// loop defaults to 30s (systemConfigDef), and chained effects (command → device → poll) can span two ticks.
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
