// Unit tests for the queue in isolation — no OcppCentralSystem, no socket.
// OcppCentralSystem's own tests (OcppMessageOrdering.test.ts) prove the
// ordering guarantee end to end over a real message handler; these prove
// the class's own contract: strict FIFO one-at-a-time execution, a bounded
// depth that rejects rather than grows unboundedly, and resilience to a
// handler that rejects or never settles.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { OcppMessageQueue } from "./OcppMessageQueue.ts";

describe("OcppMessageQueue", () => {
  const logger = new Logger("OcppMessageQueueTest", "error");
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs jobs strictly one at a time, in the order they were enqueued", async () => {
    const queue = new OcppMessageQueue(logger, "cp-1");
    const order: number[] = [];
    // Holder object rather than a reassigned `let` — the executor below runs
    // synchronously, so `resolver.release` is always a real function by the
    // time anything reads it.
    const resolver = { release: () => {} };

    queue.enqueue(() =>
      new Promise<void>((resolve) => {
        resolver.release = () => {
          order.push(1);
          resolve();
        };
      })
    );
    queue.enqueue(() => {
      order.push(2);
      return Promise.resolve();
    });

    // The second job must not run while the first is still pending — that
    // is the entire guarantee this class exists to provide.
    await tick();
    expect(order).toEqual([]);

    resolver.release();
    await tick();
    expect(order).toEqual([1, 2]);
  });

  it("rejects once the bound is reached, without throwing", () => {
    const queue = new OcppMessageQueue(logger, "cp-1", 2);
    const neverSettles = () => new Promise<void>(() => {});

    expect(queue.enqueue(neverSettles)).toBe(true); // starts running: depth 1
    expect(queue.enqueue(neverSettles)).toBe(true); // queued: depth 2
    expect(queue.enqueue(neverSettles)).toBe(false); // depth already at bound
  });

  it("exposes depth as jobs waiting plus the one currently running", () => {
    const queue = new OcppMessageQueue(logger, "cp-1", 5);
    const neverSettles = () => new Promise<void>(() => {});

    expect(queue.depth).toBe(0);
    queue.enqueue(neverSettles);
    expect(queue.depth).toBe(1); // running
    queue.enqueue(neverSettles);
    expect(queue.depth).toBe(2); // running + 1 queued
  });

  it("a rejected job is logged and does not wedge the queue for later ones", async () => {
    const queue = new OcppMessageQueue(logger, "cp-1");
    const ran: string[] = [];

    queue.enqueue(() => Promise.reject(new Error("boom")));
    queue.enqueue(() => {
      ran.push("second");
      return Promise.resolve();
    });

    await tick();
    expect(ran).toEqual(["second"]);
  });

  it("a job that throws synchronously does not wedge the queue for later ones", async () => {
    const queue = new OcppMessageQueue(logger, "cp-1");
    const ran: string[] = [];

    queue.enqueue(() => {
      throw new Error("boom, before returning a promise at all");
    });
    queue.enqueue(() => {
      ran.push("second");
      return Promise.resolve();
    });

    await tick();
    expect(ran).toEqual(["second"]);
  });

  it("a job that never settles is abandoned after its timeout, freeing the queue for the next one", async () => {
    const queue = new OcppMessageQueue(logger, "cp-1", 64, 10); // 10ms timeout
    const ran: string[] = [];

    queue.enqueue(() => new Promise<void>(() => {})); // never resolves
    queue.enqueue(() => {
      ran.push("second");
      return Promise.resolve();
    });

    // Real wall-clock wait, comfortably past the 10ms handler timeout.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ran).toEqual(["second"]);
  });
});
