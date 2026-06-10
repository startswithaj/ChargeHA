import { useSyncExternalStore } from "react";
import type { Page } from "../components/Layout/AppLayout.tsx";
import { stripBase, withBase } from "../lib/basePath.ts";

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

// ── Navigation store ────────────────────────────────────────────────────────
// A module singleton so any component can navigate without prop-drilling, and
// so updates are synchronous (no dependence on effect order — a child can
// navigate during its mount and the mounted router still sees it).
const routeFromUrl = (): Route =>
  routeFromPath(stripBase(globalThis.location.pathname));

// deno-lint-ignore custom-no-let/no-let
let currentRoute: Route = routeFromUrl();
const listeners = new Set<() => void>();

const setRoute = (next: Route): void => {
  currentRoute = next;
  listeners.forEach((notify) => notify());
};

/**
 * Navigate from anywhere. Updates the URL (base-prefixed for GitHub Pages) and
 * the store; every mounted useRouter re-renders.
 */
const navigate = (target: Route): void => {
  globalThis.history.pushState(null, "", withBase(pathFromRoute(target)));
  setRoute(target);
};

// Browser back/forward: re-derive the route from the URL.
globalThis.addEventListener("popstate", () => setRoute(routeFromUrl()));

const subscribe = (notify: () => void): () => void => {
  // First subscriber after a fresh mount re-syncs from the URL, so a direct
  // history change (e.g. between tests) is reflected.
  if (listeners.size === 0) currentRoute = routeFromUrl();
  listeners.add(notify);
  return () => listeners.delete(notify);
};

export function useRouter() {
  const route = useSyncExternalStore(subscribe, () => currentRoute);
  return { route, navigate };
}
