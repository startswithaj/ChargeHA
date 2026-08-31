/**
 * Demo-mode gating. This is the canonical place that reads VITE_DEMO_MODE —
 * everything goes through `demoMode`, except trpcSetup/main, which read the
 * literal inline so Vite can statically tree-shake the demo engine out of the
 * real production build.
 */

export enum Feature {
  OidcAuth = "oidc-auth",
}

/** Core features disabled in a demo build. */
const DEMO_DISABLED: ReadonlySet<Feature> = new Set([Feature.OidcAuth]);

// Augment the global ImportMeta so `import.meta.env.VITE_DEMO_MODE` is typed
// without aliasing import.meta (the alias form breaks Vite's static replacement).
declare global {
  interface ImportMetaEnv {
    readonly VITE_DEMO_MODE?: string;
    readonly DEV?: boolean;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

/** True only under `vite dev`. Read inline so Vite folds it to a literal and
 *  drops dev-only branches from the production bundle. */
export const isDev = (): boolean => import.meta.env.DEV === true;

interface PluginOption {
  id: string;
  demoAvailable?: boolean;
}

export const demoMode = {
  /** True in a VITE_DEMO_MODE=1 build. */
  isActive: (): boolean => import.meta.env.VITE_DEMO_MODE === "1",

  /** Whether a core feature is available (gated off in demo). */
  allows: (feature: Feature): boolean =>
    !demoMode.isActive() || !DEMO_DISABLED.has(feature),

  /** Plugin ids the demo build can't use — empty outside demo. Mirrors the
   *  wizard's gating; used to disable/hide gated plugins in settings. */
  blockedPlugins: (
    options: ReadonlyArray<PluginOption>,
  ): ReadonlySet<string> => {
    if (!demoMode.isActive()) return new Set();
    return new Set(options.filter((o) => !o.demoAvailable).map((o) => o.id));
  },
};
