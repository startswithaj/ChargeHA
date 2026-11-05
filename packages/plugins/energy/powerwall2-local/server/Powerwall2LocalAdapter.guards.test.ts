import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { Powerwall2LocalAdapter } from "./Powerwall2LocalAdapter.ts";
import {
  aggregates,
  FakePowerwallApi,
  NOW,
} from "./test-helpers/powerwallApi.ts";

class DeferredApi extends FakePowerwallApi {
  readonly secondRequest = Promise.withResolvers<void>();
  readonly requests: {
    path: string;
    signal?: AbortSignal;
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  override getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      this.requests.push({
        path,
        signal,
        resolve: (data) => {
          signal?.removeEventListener("abort", abort);
          resolve(data);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      if (this.requests.length === 2) this.secondRequest.resolve();
    });
  }
}

describe("Powerwall poll containment", () => {
  let api: DeferredApi;
  let adapter: Powerwall2LocalAdapter;
  beforeEach(() => {
    api = new DeferredApi(aggregates());
    adapter = new Powerwall2LocalAdapter(
      api,
      60,
      new Logger("PowerwallGuardTest", "error"),
      () => NOW,
    );
  });
  afterEach(async () => {
    await adapter.disconnect();
  });

  it("reads aggregates before requesting battery state of charge", async () => {
    const first = adapter.getRealtimeData();

    expect(api.requests.map((request) => request.path)).toEqual([
      "/api/meters/aggregates",
    ]);

    api.requests[0].resolve(aggregates());
    await api.secondRequest.promise;

    expect(api.requests.map((request) => request.path)).toEqual([
      "/api/meters/aggregates",
      "/api/system_status/soe",
    ]);

    api.requests[1].resolve({ percentage: 50 });

    expect((await first).batterySoc).toBeCloseTo(47.36842105263158, 10);
  });

  it("does not launch a sibling after a failed aggregate read", async () => {
    const result = adapter.getRealtimeData();
    const rejected = expect(result).rejects.toThrow("connection failed");

    api.requests[0].reject(new Error("offline"));
    await rejected;

    expect(api.requests).toHaveLength(1);
  });

  it("propagates the poller's cancellation without starting another read", async () => {
    const controller = new AbortController();
    const result = adapter.getRealtimeData(controller.signal);
    const rejected = expect(result).rejects.toThrow("cancelled");

    controller.abort(new Error("reconfigured"));
    await rejected;

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0].signal?.aborted).toBe(true);
  });
});
