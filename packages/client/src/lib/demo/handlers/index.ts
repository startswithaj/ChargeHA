import type { QueryHandler } from "./types.ts";
import { statsHandlers } from "./stats.ts";
import { configHandlers } from "./config.ts";
import { wizardHandlers } from "./wizard.ts";
import { authHandlers } from "./auth.ts";
import { scheduleHandlers } from "./schedule.ts";
import { tariffHandlers } from "./tariff.ts";
import { miscHandlers } from "./misc.ts";

// Domain handler maps are spread in here as each is built (Phase 4d).
// Keys must stay in sync with HANDLED_QUERIES in ../demoPaths.ts — enforced by
// demoPaths.test.ts.
export const queryHandlers: Record<string, QueryHandler> = {
  ...statsHandlers,
  ...configHandlers,
  ...wizardHandlers,
  ...authHandlers,
  ...scheduleHandlers,
  ...tariffHandlers,
  ...miscHandlers,
};
