import type { Logger } from "@chargeha/server/lib/Logger";

// How long one queued CALL handler gets before the queue abandons it. Covers
// the one genuine `await` (the `hasChargerRow` DB lookup) but stays far under
// OcppFraming's 30s CALL_TIMEOUT_MS for a real network round trip.
const HANDLER_TIMEOUT_MS = 5_000;

// How many CALLs may be waiting (queued, plus running) before a charge
// point's backlog is rejected outright. OCPP 1.6 chargers send infrequently,
// so a deep backlog means handlers are stuck, not bursty traffic.
const MAX_QUEUE_DEPTH = 64;

// Runs one CALL handler at a time per charge point, in wire order.
// OcppCentralSystem.onMessage used to fire handlers unawaited, so two frames
// in wire order could finish mutating state in either order, decided by DB latency.
export class OcppMessageQueue {
  private readonly jobs: Array<() => Promise<void>> = [];
  private running = false;
  private stopped = false;

  constructor(
    private readonly logger: Logger,
    private readonly chargePointId: string,
    private readonly maxDepth: number = MAX_QUEUE_DEPTH,
    private readonly timeoutMs: number = HANDLER_TIMEOUT_MS,
  ) {}

  // Jobs waiting plus the one currently running, if any. Read-only — for
  // logs/health to surface a charge point whose handling is falling behind.
  get depth(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  // Lets a refused enqueue be told apart from a full one: there is nobody
  // left to answer on a stopped queue's socket.
  get isStopped(): boolean {
    return this.stopped;
  }

  // Discard the backlog and refuse more. A replaced or closed connection's
  // queued CALLs would answer for a charger that has already hung up.
  stop(): void {
    this.stopped = true;
    this.jobs.length = 0;
  }

  // Queue a job. Returns false, without running or queuing it, once
  // `maxDepth` is reached — the caller decides what that means on the wire
  // (OcppCentralSystem replies with a CALLERROR rather than a silent drop).
  enqueue(job: () => Promise<void>): boolean {
    if (this.stopped || this.depth >= this.maxDepth) return false;
    this.jobs.push(job);
    void this.drain();
    return true;
  }

  // Runs queued jobs one at a time until none are left. enqueue() calls this
  // after every push, but `running` makes a second concurrent call a no-op —
  // only one drain loop is ever active, picking up whatever was pushed meanwhile.
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.drainQueued();
    this.running = false;
  }

  // Recursive rather than a loop — pulls one job off the front, runs it, and
  // recurses until the queue is empty.
  private async drainQueued(): Promise<void> {
    if (this.stopped) return;
    const job = this.jobs.shift();
    if (job === undefined) return;
    await this.runWithBound(job);
    await this.drainQueued();
  }

  // Runs one job under the per-handler timeout, and never lets it escape as
  // a rejection — a stuck or throwing handler must cost this one message,
  // not wedge every message behind it for the rest of the socket's life.
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
      this.logger.warn(
        `OCPP handler for ${this.chargePointId} failed or timed out: ${error}`,
      );
    } finally {
      if (timer.id !== undefined) clearTimeout(timer.id);
    }
  }
}
