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

const viteMeta = import.meta as ImportMeta & {
  env?: { VITE_DEMO_MODE?: string };
};

export const isDemoMode = (): boolean => viteMeta.env?.VITE_DEMO_MODE === "1";

/** Pure predicate — takes demoMode explicitly so it is testable. */
export const featureEnabledIn = (
  demoMode: boolean,
  feature: Feature,
): boolean => (demoMode ? !DEMO_DISABLED.has(feature) : true);

export const isFeatureEnabled = (feature: Feature): boolean =>
  featureEnabledIn(isDemoMode(), feature);
