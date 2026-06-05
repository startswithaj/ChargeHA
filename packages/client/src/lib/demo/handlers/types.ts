import type { DemoState } from "../demoState.ts";
import type {
  MutationInput,
  MutationOutput,
  MutationPath,
} from "../queryPaths.ts";

/**
 * A demo query handler: a pure read from demo state / the aggregator / the tick.
 * Each domain file (energy.ts, stats.ts, …) exports a Record<string, QueryHandler>
 * keyed by exact tRPC path; resolveDemoOp composes them.
 */
export type QueryHandler = (input: unknown, state: DemoState) => unknown;

/** A demo mutation handler, typed to its path's real input and result. */
export type MutationHandler<P extends MutationPath> = (
  input: MutationInput<P>,
) => MutationOutput<P>;

/**
 * Path → handler map. Each handler is checked against its own path's input and
 * output types; a wrong shape or unknown path is a compile error. Partial so
 * domain files declare only their own paths; the coverage test guarantees the
 * union of all maps + GATED + PENDING covers the real router.
 */
export type MutationHandlers = { [P in MutationPath]?: MutationHandler<P> };
