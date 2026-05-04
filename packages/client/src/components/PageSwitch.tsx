import type { Page } from "./Layout/AppLayout.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { Dashboard } from "./pages/Dashboard/Dashboard.tsx";
import { Stats } from "./pages/Stats/Stats.tsx";
import { Schedules } from "./pages/Schedules/Schedules.tsx";
import { Logs } from "./pages/Logs/Logs.tsx";
import { Settings } from "./pages/Settings/Settings.tsx";

const PAGE_LABELS: Record<Page, string> = {
  dashboard: "Dashboard",
  stats: "Stats",
  schedules: "Schedules",
  logs: "Logs",
  settings: "Settings",
};

export function renderPage(page: Page, onNavigate: (p: Page) => void) {
  const pages: Record<Page, () => React.JSX.Element> = {
    dashboard: () => (
      <Dashboard onNavigateSettings={() => onNavigate("settings")} />
    ),
    stats: () => <Stats />,
    schedules: () => (
      <Schedules onNavigateSettings={() => onNavigate("settings")} />
    ),
    logs: () => <Logs />,
    settings: () => <Settings />,
  };
  const content = pages[page]();
  return <ErrorBoundary label={PAGE_LABELS[page]}>{content}</ErrorBoundary>;
}
