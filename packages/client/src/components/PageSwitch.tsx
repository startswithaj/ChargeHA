import type { Page } from "./Layout/AppLayout.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { Dashboard } from "./pages/Dashboard/Dashboard.tsx";
import { Schedules } from "./pages/Schedules/Schedules.tsx";

const PAGE_LABELS: Record<Page, string> = {
  dashboard: "Dashboard",
  schedules: "Schedules",
};

export function renderPage(page: Page, onNavigate: (p: Page) => void) {
  const pages: Record<Page, () => React.JSX.Element> = {
    dashboard: () => (
      <Dashboard onNavigateSettings={() => onNavigate("settings")} />
    ),
    schedules: () => (
      <Schedules onNavigateSettings={() => onNavigate("settings")} />
    ),
  };
  const content = pages[page]();
  return <ErrorBoundary label={PAGE_LABELS[page]}>{content}</ErrorBoundary>;
}
