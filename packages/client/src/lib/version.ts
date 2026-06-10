// The running build's git commit SHA, baked in at build time via Vite
// (VITE_GIT_SHA — set by the Docker build and the demo build). "dev" otherwise.
const env =
  (import.meta as ImportMeta & { env?: { VITE_GIT_SHA?: string } }).env;
const fullSha = env?.VITE_GIT_SHA ?? "";

export const version = {
  /** Short commit SHA of the running build, or "dev". */
  sha: fullSha ? fullSha.slice(0, 7) : "dev",
  /** GitHub commit URL for this build, or null when unknown. */
  commitUrl: fullSha
    ? `https://github.com/startswithaj/ChargeHA/commit/${fullSha}`
    : null,
};
