import type { Logger } from "@chargeha/server/lib/Logger";

/** How long one queued CALL handler gets before the queue gives up on it and
 *  moves on. Generous for the one genuine `await` inside a queued handler —
 *  the charger-row lookup (`hasChargerRow`), an uncached DB round trip on
 *  every message — but far under OcppFraming's CALL_TIMEOUT_MS (30s), which
 *  bounds a round trip to the charger itself over the network. A local
 *  lookup stuck past 5s is wedged, not just slow, so there is no reason to
 *  give it as long as a real network call.
 *
 *  Note the trade this makes: firing the timeout ABANDONS the ordering
 *  guarantee for that one message. The job keeps running (JS cannot cancel
 *  an in-flight async function), the next job starts, and the abandoned one
 *  can still land its patch() afterwards — the very reordering this queue
 *  exists to prevent. That is deliberate: a permanently wedged charge point
 *  is worse than one out-of-order message, and at 5s against a lookup that
 *  normally takes milliseconds it should never fire in practice. If it ever
 *  does, the warning below is the signal that something upstream is stuck. */
const HANDLER_TIMEOUT_MS = 5_000;

/** How many CALLs may be waiting (queued, plus the one currently running)
 *  before a charge point's backlog is rejected outright. OCPP 1.6 chargers
 *  send infrequently — a Heartbeat every few minutes, MeterValues roughly
 *  once a minute during a session — so a backlog this deep means handlers
 *  are stuck, not that traffic is merely bursty. 64 comfortably covers any
 *  legitimate burst (BootNotification followed by a handful of
 *  StatusNotifications) while still bounding memory against a wedged or
 *  flooding client. */
const MAX_QUEUE_DEPTH = 64;

/**
 * Runs one CALL handler at a time per charge point, in the order the wire
 * delivered them.
 *
 * OcppCentralSystem.onMessage used to fire each CALL handler without
 * awaiting it, so two frames that arrived in the right wire order could
 * finish their state mutations in either order — decided by whichever one's
 * charger-row lookup (a DB round trip) happened to come back first. This
 * queue removes the ambiguity structurally: a handler is not even started
 * until the one queued before it (on the same connection) has finished, so
 * ordering no longer depends on how fast anything happens to resolve. That
 * guarantee holds even once a handler grows a new `await` nobody thought to
 * check against this class.
 *
 * Deliberately knows nothing about OCPP framing or sockets — it is a
 * generic bounded, ordered job runner. OcppCentralSystem decides what a
 * rejected job means on the wire (a CALLERROR).
 */
export class OcppMessageQueue {
  private readonly jobs: Array<() => Promise<void>> = [];
  private running = false;

  constructor(
    private readonly logger: Logger,
    private readonly chargePointId: string,
    private readonly maxDepth: number = MAX_QUEUE_DEPTH,
    private readonly timeoutMs: number = HANDLER_TIMEOUT_MS,
  ) {}

  /** Jobs waiting plus the one currently running, if any. Read-only — for
   *  logs/health to surface a charge point whose handling is falling
   *  behind. */
  get depth(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  /** Queue a job. Returns false, without running or queuing it, once
   *  `maxDepth` is already reached — the caller decides what that means on
   *  the wire (OcppCentralSystem replies with a CALLERROR rather than
   *  silently dropping the message). */
  enqueue(job: () => Promise<void>): boolean {
    if (this.depth >= this.maxDepth) return false;
    this.jobs.push(job);
    void this.drain();
    return true;
  }

  /** Runs queued jobs one at a time until none are left. enqueue() calls
   *  this after every push, but `running` makes a second concurrent call a
   *  no-op — only one drain loop is ever active, and it keeps picking up
   *  whatever enqueue() pushed while it was busy. */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.drainQueued();
    this.running = false;
  }

  /** Recursive rather than a loop — pulls one job off the front, runs it,
   *  and recurses until the queue is empty. */
  private async drainQueued(): Promise<void> {
    const job = this.jobs.shift();
    if (job === undefined) return;
    await this.runWithBound(job);
    await this.drainQueued();
  }

  /** Runs one job under the per-handler timeout, and never lets it escape as
   *  a rejection — a stuck or throwing handler must cost this one message,
   *  not wedge every message behind it for the rest of the socket's life. */
  private async runWithBound(job: () => Promise<void>): Promise<void> {
    const timer: { id?: ReturnType<typeof setTimeout> } = {};
    try {
      await Promise.race([
        job(),
        new Promise<never>((_resolve, reject) => {
          timer.id = setTimeout(
            () =>
              reject(
                new Error(`OCPP handler timed out after ${this.timeoutMs}ms`),
              ),
            this.timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      // A timed-out job keeps running in the background — JS has no way to
      // cancel an in-flight async function — but the queue moves on rather
      // than waiting for it, which is the whole point of a bound. If it
      // eventually finishes, whatever it does (send a reply, patch state)
      // still happens, just later and out of the queue's view.
      this.logger.warn(
        `OCPP handler for ${this.chargePointId} failed or timed out: ${error}`,
      );
    } finally {
      if (timer.id !== undefined) clearTimeout(timer.id);
    }
  }
}
