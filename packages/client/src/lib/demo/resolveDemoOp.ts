import { getDemoState } from "./demoState.ts";
import { queryHandlers } from "./handlers/index.ts";
import { GATED_QUERIES } from "./demoPaths.ts";

/** Thrown when a demo-gated path is called (degrades gracefully in demoLink). */
export class DemoGatedError extends Error {
  constructor(path: string) {
    super(`"${path}" is not available in demo mode`);
    this.name = "DemoGatedError";
  }
}

/** Thrown when a query path has no handler and isn't gated — a coverage gap. */
export class DemoUnhandledError extends Error {
  constructor(path: string) {
    super(`No demo handler for query "${path}"`);
    this.name = "DemoUnhandledError";
  }
}

/** Resolve a query path + input to its demo response. */
export const resolveDemoQuery = (path: string, input: unknown): unknown => {
  const handler = queryHandlers[path];
  if (handler) return handler(input, getDemoState());
  if (GATED_QUERIES.includes(path)) throw new DemoGatedError(path);
  throw new DemoUnhandledError(path);
};
