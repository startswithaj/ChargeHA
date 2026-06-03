import type { QueryHandler } from "./types.ts";

// Domain handler maps are spread in here as each is built (Phase 4d).
// Keys must stay in sync with HANDLED_QUERIES in ../demoPaths.ts — enforced by
// demoPaths.test.ts.
export const queryHandlers: Record<string, QueryHandler> = {};
