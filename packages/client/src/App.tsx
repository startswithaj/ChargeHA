import { lazy, Suspense, useCallback, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Theme } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { queryClient, trpcClient } from "./lib/trpcSetup.ts";
import { useRouter } from "./hooks/useRouter.ts";
import type { Route } from "./hooks/useRouter.ts";
import type { Page } from "./components/Layout/AppLayout.tsx";
import { AuthGate } from "./components/AuthGate.tsx";
import { RealtimeSync } from "./components/RealtimeSync.tsx";
import { WizardRouter } from "./components/WizardRouter.tsx";
import { PluginSetupRouter } from "./components/PluginSetupRouter.tsx";
import { AppLayout } from "./components/Layout/AppLayout.tsx";
import { renderPage } from "./components/PageSwitch.tsx";
import { ToastProvider } from "./hooks/useToast.tsx";
import { ToastContainer } from "./components/Toast/Toast.tsx";
import { useStoredState } from "./lib/storage.ts";

// Only load devtools in development — lazy import keeps them out of production bundles
const viteMeta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
const devtoolsLoader = () =>
  import("@tanstack/react-query-devtools").then((m) => ({
    default: m.ReactQueryDevtools,
  }));
const ReactQueryDevtools = viteMeta.env?.DEV
  ? lazy(devtoolsLoader)
  : () => null;

type Appearance = "light" | "dark";

/** Redirects to wizard on first run. Rendered inside AuthGate so it only queries when authenticated. */
function FirstRunRedirect() {
  const { route, navigate } = useRouter();
  const wizardStatusQuery = trpc.wizard.status.useQuery(undefined, {
    enabled: route.type !== "wizard",
    retry: false,
  });
  useEffect(() => {
    if (route.type !== "wizard" && wizardStatusQuery.data?.firstRun) {
      navigate({ type: "wizard" });
    }
  }, [route, wizardStatusQuery.data, navigate]);
  return null;
}

function renderRoute(
  route: Route,
  navigate: (r: Route) => void,
  layout: {
    appearance: Appearance;
    onToggleAppearance: () => void;
    onNavigate: (page: Page) => void;
    authMode: string;
    onLogout: () => void;
  },
) {
  if (route.type === "pluginSetup") {
    return <PluginSetupRouter pluginId={route.pluginId} />;
  }
  if (route.type === "wizard") {
    return (
      <WizardRouter
        onComplete={() => navigate({ type: "app", page: "dashboard" })}
      />
    );
  }
  const page = route.type === "app" ? route.page : "dashboard";
  return (
    <AppLayout
      appearance={layout.appearance}
      onToggleAppearance={layout.onToggleAppearance}
      activePage={page}
      onNavigate={layout.onNavigate}
      authMode={layout.authMode}
      onLogout={layout.onLogout}
    >
      {renderPage(page, layout.onNavigate)}
    </AppLayout>
  );
}

function AppContent() {
  const prefersDark =
    globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  const systemDefault: Appearance = prefersDark ? "dark" : "light";
  const [appearance, setAppearance] = useStoredState<Appearance>(
    "theme",
    systemDefault,
  );
  const toggleAppearance = useCallback(() => {
    setAppearance(appearance === "dark" ? "light" : "dark");
  }, [appearance, setAppearance]);
  const { route, navigate } = useRouter();
  const navToPage = useCallback(
    (page: Page) => navigate({ type: "app", page }),
    [navigate],
  );

  return (
    <Theme appearance={appearance}>
      <ToastProvider>
        <AuthGate>
          {({ authMode, onLogout }) => (
            <>
              <RealtimeSync />
              <FirstRunRedirect />
              {renderRoute(route, navigate, {
                appearance,
                onToggleAppearance: toggleAppearance,
                onNavigate: navToPage,
                authMode,
                onLogout,
              })}
            </>
          )}
        </AuthGate>
        <ToastContainer />
      </ToastProvider>
    </Theme>
  );
}

export function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
        <Suspense>
          <ReactQueryDevtools />
        </Suspense>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
