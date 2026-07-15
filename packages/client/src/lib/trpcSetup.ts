import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
  type TRPCLink,
} from "@trpc/client";
import type { AppRouter } from "../../../server/src/trpc/root.ts";
import { trpc } from "../trpc.ts";
import { demoLink } from "./demo/demoLink.ts";

// One of the two deliberate exceptions to going through `demoMode` (see
// featureFlags.ts): read the literal inline so the bundler statically replaces
// it and eliminates the demoLink branch — and the whole demo engine — from the
// real production build. A `demoMode.isActive()` call can't be tree-shaken.
const isDemoBuild = import.meta.env.VITE_DEMO_MODE === "1";

/** Check whether a tRPC error indicates an UNAUTHORIZED response. */
export function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  // tRPC procedure-level UNAUTHORIZED
  if (error.data?.code === "UNAUTHORIZED") return true;
  // HTTP-level 401 from auth middleware
  const meta = error.meta as { response?: { status?: number } } | undefined;
  if (meta?.response?.status === 401) return true;
  return false;
}

/** Retry predicate for tanstack-query — never retry UNAUTHORIZED, retry once otherwise. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  // Never retry UNAUTHORIZED — redirect to login instead
  if (isUnauthorizedError(error)) return false;
  return failureCount < 1;
}

/** Clears the query client when the given error is an auth error. */
export function handleAuthError(error: unknown): void {
  if (isUnauthorizedError(error)) {
    queryClient.clear();
  }
}

/** Auto-invalidate config cache after any mutation succeeds,
 * so subsequent steps always see fresh config values. */
export function invalidateConfigOnMutation(): void {
  queryClient.invalidateQueries({ queryKey: [["config", "getAll"]] });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: shouldRetry,
      refetchOnWindowFocus: true,
    },
  },
  queryCache: new QueryCache({
    onError: handleAuthError,
  }),
  mutationCache: new MutationCache({
    onError: handleAuthError,
    onSuccess: invalidateConfigOnMutation,
  }),
});

// vehicle.list is DB + cached state (no vendor API cost) and is read by both
// main and plugin UIs — always-fresh so plugins never need to invalidate
// main's cache. Live membership changes arrive via the vehicles_changed SSE
// event; this covers mounts.
queryClient.setQueryDefaults([["vehicle", "list"]], {
  staleTime: 0,
  refetchOnMount: "always",
});

const createLinks = (): TRPCLink<AppRouter>[] => {
  if (isDemoBuild) return [demoLink()];
  return [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: "/trpc",
      }),
      false: httpBatchLink({
        url: "/trpc",
      }),
    }),
  ];
};

export const trpcClient = trpc.createClient({
  links: createLinks(),
});
