import type { SSEEvent } from "@chargeha/shared";
import { publicProcedure, router } from "../trpc.ts";
import { createAsyncQueue } from "../../lib/AsyncQueue.ts";

export const subscriptionsRouter = router({
  /**
   * Single multiplexed SSE subscription for all real-time events.
   *
   * Emits initial state (energy snapshot, vehicle states, vehicle errors)
   * then forwards live events as they occur. All events are tagged with a
   * `type` field so the client can route them to the correct handler.
   *
   * Uses one EventSource connection instead of one per event type to avoid
   * exhausting the browser's 6-connection-per-origin HTTP/1.1 limit.
   * See SSEEvent type in shared/types.ts for full explanation.
   */
  onEvents: publicProcedure.subscription(async function* ({ ctx, signal }) {
    const snapshot = ctx.poller.tryGetRealtimeSnapshot();
    if (snapshot) {
      yield {
        type: "energy_update",
        data: { ...snapshot.realtime, ...snapshot.cumulative },
      } satisfies SSEEvent;
    }

    // Emit initial vehicle states
    const allStates = await ctx.vehicleManager.getAllStates();
    yield* [...allStates.values()].map((state): SSEEvent => ({
      type: "vehicle_update",
      data: state,
    }));

    // Emit initial vehicle errors
    const vehicleIds = ctx.vehicleManager.getVehicleIds();
    yield* vehicleIds
      .map((id) => ({
        id,
        error: ctx.vehicleManager.getVehicleError(id),
      }))
      .filter((
        v,
      ): v is { id: string; error: { message: string; at: string } } =>
        v.error != null
      )
      .map((v): SSEEvent => ({
        type: "vehicle_error",
        data: {
          vehicleId: v.id,
          vehicleName: allStates.get(v.id)?.vehicleName ?? v.id,
          error: v.error.message,
        },
      }));

    // Queue for live events — the generator pulls from this
    const queue = createAsyncQueue<SSEEvent>();

    // Subscribe to live events via the shared EventEmitter
    const unsubs = [
      ctx.eventEmitter.subscribe(
        "energy_update",
        (data) => queue.push({ type: "energy_update", data }),
      ),
      ctx.eventEmitter.subscribe(
        "vehicle_update",
        (data) => queue.push({ type: "vehicle_update", data }),
      ),
      ctx.eventEmitter.subscribe(
        "vehicle_error",
        (data) => queue.push({ type: "vehicle_error", data }),
      ),
      ctx.eventEmitter.subscribe(
        "controller_status",
        (data) => queue.push({ type: "controller_status", data }),
        { replay: true },
      ),
    ];

    try {
      yield* queue.drain(signal);
    } finally {
      unsubs.forEach((unsub) => unsub());
    }
  }),
});
