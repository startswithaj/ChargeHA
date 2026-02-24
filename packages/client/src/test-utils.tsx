/**
 * Shared test utilities for component and hook tests.
 *
 * - renderWithProviders(ui)  wraps with QueryClientProvider + Theme + ToastProvider
 * - createTestQueryClient()  returns a QueryClient configured for test isolation
 *
 * Usage:
 *   import { renderWithProviders } from "../../test-utils.tsx";
 *   renderWithProviders(<MyComponent />);
 *
 * If a test mocks useToast.tsx, use importOriginal to preserve ToastProvider:
 *   vi.mock("../../hooks/useToast.tsx", async (importOriginal) => ({
 *     ...await importOriginal<typeof import("../../hooks/useToast.tsx")>(),
 *     useToast: vi.fn(),
 *   }));
 */
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Theme } from "@radix-ui/themes";
import { vi } from "vitest";
import { ToastProvider } from "./hooks/useToast.tsx";
import type { ReactElement, ReactNode } from "react";

// Radix Select/Checkbox require ResizeObserver and Element.scrollIntoView in
// jsdom. Installed once here so individual tests don't have to repeat the
// polyfill block.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

/** Creates a QueryClient tuned for test isolation: no retries, no cache persistence. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Renders `ui` inside QueryClientProvider + Theme + ToastProvider with a fresh QueryClient. */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ToastProvider>{children}</ToastProvider>
        </Theme>
      </QueryClientProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}
