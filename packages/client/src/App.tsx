import { Theme } from "@radix-ui/themes";
import { useRouter } from "./hooks/useRouter.ts";
import type { Route } from "./hooks/useRouter.ts";
import type { Page } from "./components/Layout/AppLayout.tsx";
import { RealtimeSync } from "./components/RealtimeSync.tsx";
import { AppLayout } from "./components/Layout/AppLayout.tsx";
import { ToastProvider } from "./hooks/useToast.tsx";
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
function AppContent() {
  const { route, navigate } = useRouter();
  return (
    <Theme appearance={appearance}>
      <ToastProvider>
              <RealtimeSync />
      </ToastProvider>
    </Theme>
  );
}
export function App() {
  return (
        <AppContent />
  );
}
