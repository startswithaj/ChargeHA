import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AnyRouter } from "@trpc/server";
import type { SSEEvent } from "@chargeha/shared";
import { resolveDemoMutation, resolveDemoQuery } from "./resolveDemoOp.ts";
import { getDemoState } from "./demoState.ts";
import { currentSnapshot, onDemoTick, runLiveController } from "./demoTick.ts";
import { demoNow } from "./demoClock.ts";
import { buildVehicleState } from "./handlers/vehicleState.ts";

/**
 * The events emitted on each tick: the current energy snapshot plus a
 * vehicle_update per vehicle (the live controller advances charging first), so
 * the dashboard's energy tile and car cards both animate.
 */
const tickEvents = (now: Date): SSEEvent[] => {
  const vehicles = runLiveController(now);
  const iso = now.toISOString();
  const snap = currentSnapshot(getDemoState(), now);
  return [
    { type: "energy_update", data: { ...snap.realtime, ...snap.cumulative } },
    ...vehicles.map((v): SSEEvent => ({
      type: "vehicle_update",
      data: buildVehicleState(v, iso),
    })),
  ];
};

/**
 * Terminating tRPC link for demo mode. Queries/mutations resolve synchronously
 * from demo state; the single subscription (subscription.onEvents) emits an
 * energy snapshot now and on every demo tick — the in-browser stand-in for SSE.
 */
export const demoLink =
  <TRouter extends AnyRouter>(): TRPCLink<TRouter> => () => ({ op }) =>
    observable((observer) => {
      if (op.type === "subscription") {
        const emit = () =>
          tickEvents(demoNow()).forEach((data) =>
            observer.next({ result: { type: "data", data } })
          );
        observer.next({ result: { type: "started" } });
        emit();
        return onDemoTick(emit);
      }
      try {
        const data = op.type === "mutation"
          ? resolveDemoMutation(op.path, op.input)
          : resolveDemoQuery(op.path, op.input);
        observer.next({ result: { data } });
        observer.complete();
      } catch (err) {
        observer.error(TRPCClientError.from(err as Error));
      }
      return () => {};
    });
