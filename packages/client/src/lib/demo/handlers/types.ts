import type { DemoState } from "../demoState.ts";
import type {
  MutationInput,
  MutationOutput,
  MutationPath,
} from "../queryPaths.ts";
import type { RequiredMutationPath } from "../demoPaths.ts";

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
 * Path → handler map, TOTAL over every required (non-gated) mutation. Each
 * handler is checked against its own path's input and output types; a wrong
 * shape, a missing handler, or a new ungated router mutation is a compile error.
 */
export type MutationHandlers = {
  [P in RequiredMutationPath]: MutationHandler<P>;
};
