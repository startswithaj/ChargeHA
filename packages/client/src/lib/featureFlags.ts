/**
 * Demo-mode feature gating for CORE features (not plugins — plugin availability
 * is data-driven via the `demoAvailable` flag on plugin option metadata).
 */

export enum Feature {
  OidcAuth = "oidc-auth",
}

/** Core features disabled when the app is built in demo mode. */
const DEMO_DISABLED: ReadonlySet<Feature> = new Set([
  Feature.OidcAuth,
]);

// Augment the global ImportMeta so `import.meta.env.VITE_DEMO_MODE` is typed
// without aliasing import.meta. The alias form (`const m = import.meta; m.env`)
// breaks Vite's static replacement — Vite only substitutes the literal
// `import.meta.env.X` member expression — so demo mode would never activate in
// a build. Access it directly everywhere instead.
declare global {
  interface ImportMetaEnv {
    readonly VITE_DEMO_MODE?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export const isDemoMode = (): boolean => import.meta.env.VITE_DEMO_MODE === "1";

/** Pure predicate — takes demoMode explicitly so it is testable. */
export const featureEnabledIn = (
  demoMode: boolean,
  feature: Feature,
): boolean => (demoMode ? !DEMO_DISABLED.has(feature) : true);

export const isFeatureEnabled = (feature: Feature): boolean =>
  featureEnabledIn(isDemoMode(), feature);

/** Plugin option ids the demo build can't use — empty outside demo mode. Used to
 *  disable/hide gated plugins (Tesla, Fronius) in settings, mirroring the wizard. */
export const demoBlockedPluginIds = (
  options: ReadonlyArray<{ id: string; demoAvailable?: boolean }>,
): ReadonlySet<string> => {
  if (!isDemoMode()) return new Set<string>();
  return new Set(options.filter((o) => !o.demoAvailable).map((o) => o.id));
};
