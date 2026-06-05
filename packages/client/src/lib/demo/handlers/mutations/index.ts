import type { MutationHandlers } from "../types.ts";

// Per-domain maps spread in here as each is built (5c–5e). Each domain map is
// typed MutationHandlers, so misspelled paths / wrong shapes fail compilation;
// the coverage test enforces total coverage of the real router.
export const mutationHandlers: MutationHandlers = {};
