import type { DemoState } from "../demoState.ts";

/**
 * A demo query handler: a pure read from demo state / the aggregator / the tick.
 * Each domain file (energy.ts, stats.ts, …) exports a Record<string, QueryHandler>
 * keyed by exact tRPC path; resolveDemoOp composes them.
 */
export type QueryHandler = (input: unknown, state: DemoState) => unknown;
