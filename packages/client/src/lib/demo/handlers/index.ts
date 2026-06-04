import type { QueryHandler } from "./types.ts";
import { statsHandlers } from "./stats.ts";
import { configHandlers } from "./config.ts";
import { wizardHandlers } from "./wizard.ts";

// Domain handler maps are spread in here as each is built (Phase 4d).
// Keys must stay in sync with HANDLED_QUERIES in ../demoPaths.ts — enforced by
// demoPaths.test.ts.
export const queryHandlers: Record<string, QueryHandler> = {
  ...statsHandlers,
  ...configHandlers,
  ...wizardHandlers,
};
