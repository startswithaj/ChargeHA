// The deploy base ("/ChargeHA/" on GitHub Pages, "/" in dev), from Vite's
// --base flag. Read via a cast on import.meta (matches featureFlags.ts, since
// the project doesn't pull in vite/client's ImportMetaEnv types).
const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
const BASE = (env?.BASE_URL ?? "/").replace(/\/$/, ""); // "" or "/ChargeHA"

/** Prefix an absolute app path with the deploy base (for pushState / hrefs). */
export const withBase = (path: string): string => `${BASE}${path}`;

/** Strip the deploy base from a location pathname → absolute app path. */
export const stripBase = (pathname: string): string => {
  const p = BASE && pathname.startsWith(BASE)
    ? pathname.slice(BASE.length)
    : pathname;
  return p === "" ? "/" : p;
};
