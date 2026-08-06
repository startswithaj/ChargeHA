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

/** Invalidate the entire query cache after any mutation succeeds.
 *
 * WHY blanket: mutations previously relied on the server echoing a
 * `*_changed` SSE event to refresh caches. That makes the mutating client's
 * own correctness depend on a network round-trip — if the SSE connection is
 * dropped or reconnecting, the UI stays stale indefinitely. Invalidating
 * locally makes the mutating client self-correcting; the SSE events remain
 * for syncing *other* connected clients.
 *
 * Cost is low: only active queries refetch, and httpBatchLink coalesces them
 * into a single request. Structural sharing keeps object identity stable when
 * refetched data is unchanged, so forms seeded from query data don't reset. */
export function invalidateAllOnMutation(): void {
  queryClient.invalidateQueries();
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
    onSuccess: invalidateAllOnMutation,
  }),
});

// vehicle.list is cheap and read by both main and plugin UIs, so keep it always-fresh.
queryClient.setQueryDefaults([["vehicle", "list"]], {
  staleTime: 0,
  refetchOnMount: "always",
});

queryClient.setQueryDefaults([["charger", "list"]], {
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
