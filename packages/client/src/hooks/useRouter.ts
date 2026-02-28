import { useCallback, useEffect, useState } from "react";
import type { Page } from "../components/Layout/AppLayout.tsx";

export type Route =
  | { type: "app"; page: Page }
  | { type: "wizard" }
  | { type: "pluginSetup"; pluginId: string }
  | { type: "login" };

const PATH_TO_PAGE: Record<string, Page> = {
  "/": "dashboard",
  "/stats": "stats",
  "/schedules": "schedules",
  "/logs": "logs",
  "/settings": "settings",
  "/simulator": "simulator",
};

const PAGE_TO_PATH: Record<Page, string> = {
  dashboard: "/",
  stats: "/stats",
  schedules: "/schedules",
  logs: "/logs",
  settings: "/settings",
  simulator: "/simulator",
};

export function pageFromPath(pathname: string): Page {
  return PATH_TO_PAGE[pathname] ?? "dashboard";
}

function routeFromPath(pathname: string): Route {
  if (pathname === "/wizard" || pathname.startsWith("/wizard/")) {
    return { type: "wizard" };
  }
  const setupMatch = pathname.match(/^\/setup\/([^/]+)/);
  if (setupMatch) {
    return { type: "pluginSetup", pluginId: setupMatch[1] };
  }
  if (pathname === "/login") {
    return { type: "login" };
  }
  return { type: "app", page: pageFromPath(pathname) };
}

function pathFromRoute(route: Route): string {
  switch (route.type) {
    case "app":
      return PAGE_TO_PATH[route.page];
    case "wizard":
      return "/wizard";
    case "pluginSetup":
      return `/setup/${route.pluginId}`;
    case "login":
      return "/login";
  }
}

/**
 * URL-based router hook with discriminated union route types.
 * Manages URL parsing, navigation via pushState, and popstate handling.
 */
export function useRouter() {
  const [route, setRoute] = useState<Route>(
    () => routeFromPath(globalThis.location.pathname),
  );

  const navigate = useCallback((target: Route) => {
    const path = pathFromRoute(target);
    globalThis.history.pushState(null, "", path);
    setRoute(target);
  }, []);

  // Handle browser back/forward buttons
  useEffect(() => {
    const onPopState = () =>
      setRoute(routeFromPath(globalThis.location.pathname));
    globalThis.addEventListener("popstate", onPopState);
    return () => globalThis.removeEventListener("popstate", onPopState);
  }, []);

  return { route, navigate };
}
