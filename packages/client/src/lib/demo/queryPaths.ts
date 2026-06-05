// deno-lint-ignore-file custom-plugin-refs/no-plugin-refs -- type-only twin of
// demoPaths.ts: the central inventory necessarily names every plugin router to
// derive the QueryPath union. Imports are type-only, so no plugin code crosses.

import type {
  AnyMutationProcedure,
  AnyProcedure,
  AnyQueryProcedure,
  inferProcedureInput,
  inferProcedureOutput,
} from "@trpc/server";
import type { createAppRouter } from "../../../../server/src/trpc/root.ts";
import type { teslaRouter } from "../../../../plugins/vehicles/tesla/server/router.ts";
import type { simulatedRouter } from "../../../../plugins/vehicles/simulated/server/router.ts";
import type { froniusLocalRouter } from "../../../../plugins/energy/fronius-local/server/router.ts";
import type { froniusCloudRouter } from "../../../../plugins/energy/fronius-cloud/server/router.ts";
import type { simulatedEnergyRouter } from "../../../../plugins/energy/simulated/server/router.ts";

// The fully-merged router type (core + every plugin), built purely from types —
// mirrors how each plugin's routerType.ts merges, but type-only so nothing
// reaches the client bundle. New plugin? Add its router type to this merge.
type FullAppRouter = ReturnType<
  typeof createAppRouter<
    { tesla: typeof teslaRouter; simulated: typeof simulatedRouter },
    {
      fronius_local: typeof froniusLocalRouter;
      fronius_cloud: typeof froniusCloudRouter;
      simulated_energy: typeof simulatedEnergyRouter;
    }
  >
>;

// Walk the router's nested procedure record, emitting the dotted path of every
// QUERY leaf. Mutations/subscriptions resolve to `never` and drop out.
type QueryPathsOf<TRecord> = {
  [K in keyof TRecord & string]: TRecord[K] extends AnyQueryProcedure ? K
    : TRecord[K] extends AnyProcedure ? never
    : TRecord[K] extends object ? `${K}.${QueryPathsOf<TRecord[K]>}`
    : never;
}[keyof TRecord & string];

/** Union of every QUERY path on the fully-merged router (core + all plugins). */
export type QueryPath = QueryPathsOf<FullAppRouter["_def"]["record"]>;

// Walk the router's nested procedure record, emitting the dotted path of every
// MUTATION leaf. Queries/subscriptions resolve to `never` and drop out.
type MutationPathsOf<TRecord> = {
  [K in keyof TRecord & string]: TRecord[K] extends AnyMutationProcedure ? K
    : TRecord[K] extends AnyProcedure ? never
    : TRecord[K] extends object ? `${K}.${MutationPathsOf<TRecord[K]>}`
    : never;
}[keyof TRecord & string];

/** Union of every MUTATION path on the fully-merged router (core + all plugins). */
export type MutationPath = MutationPathsOf<FullAppRouter["_def"]["record"]>;

// Resolve a dotted path to its procedure by walking the nested record (the type
// of `_def.procedures` is nested here, only flat at runtime — so we traverse the
// same `_def.record` structure the path unions above walk).
type ProcedureAt<TRecord, P extends string> = P extends
  `${infer Head}.${infer Rest}`
  ? Head extends keyof TRecord ? ProcedureAt<TRecord[Head], Rest> : never
  : P extends keyof TRecord ? TRecord[P]
  : never;

type Record_ = FullAppRouter["_def"]["record"];

/** The real input type of the mutation at path `P`. */
export type MutationInput<P extends MutationPath> = inferProcedureInput<
  ProcedureAt<Record_, P>
>;
/** The real (awaited) result type of the mutation at path `P`. */
export type MutationOutput<P extends MutationPath> = inferProcedureOutput<
  ProcedureAt<Record_, P>
>;
