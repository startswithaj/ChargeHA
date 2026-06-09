import { getDemoState } from "./demoState.ts";
import { queryHandlers } from "./handlers/index.ts";
import { mutationHandlers } from "./handlers/mutations/index.ts";
import { GATED_MUTATIONS, GATED_QUERIES } from "./demoPaths.ts";

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

/** Thrown when a mutation path has no handler and isn't gated — a coverage gap. */
export class DemoUnhandledMutationError extends Error {
  constructor(path: string) {
    super(`No demo handler for mutation "${path}"`);
    this.name = "DemoUnhandledMutationError";
  }
}

/** Resolve a query path + input to its demo response. */
export const resolveDemoQuery = (path: string, input: unknown): unknown => {
  const handler = queryHandlers[path];
  if (handler) return handler(input, getDemoState());
  if (GATED_QUERIES.includes(path)) throw new DemoGatedError(path);
  throw new DemoUnhandledError(path);
};

// The wire delivers an untyped string path + input. Authoring safety lives in
// the per-path handler maps (each handler checked against its path's IO); at
// this dynamic dispatch boundary we widen to one uniform call signature.
const mutationFns = mutationHandlers as Record<
  string,
  (input: unknown) => unknown
>;

/** Resolve a mutation path + input, mutating demo state via the handler. */
export const resolveDemoMutation = (path: string, input: unknown): unknown => {
  const handler = mutationFns[path];
  if (handler) return handler(input);
  // GATED_MUTATIONS is a literal tuple (its element type drives RequiredMutationPath);
  // widen for the runtime membership check against an arbitrary wire path.
  if ((GATED_MUTATIONS as readonly string[]).includes(path)) {
    throw new DemoGatedError(path);
  }
  throw new DemoUnhandledMutationError(path);
};
