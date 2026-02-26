import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from "@trpc/client";
import { trpc } from "../trpc.ts";

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

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: "/trpc",
      }),
      false: httpBatchLink({
        url: "/trpc",
      }),
    }),
  ],
});
