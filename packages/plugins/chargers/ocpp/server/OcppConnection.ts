import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { type OcppFrame, OcppFraming, PendingCalls } from "./OcppFraming.ts";
import { OcppMessageQueue } from "./OcppMessageQueue.ts";
import { freshData, type OcppLiveData } from "./OcppTypes.ts";

// One charge point's live socket and everything scoped to it. Per connection,
// not fields on the central system, so a second charger cannot evict the first
// nor share its transaction counter.
export class OcppConnection {
  private data: OcppLiveData = { ...freshData(), connected: true };
  // Per socket: one charger's CALLRESULT must never settle another's call.
  private readonly pending = new PendingCalls();
  private readonly queue: OcppMessageQueue;
  private transactionCounter = 0;
  private readonly stoppedTransactionIds = new Set<number>();
  // OCPP-J permits one outstanding CALL per direction; chargers drop or
  // misorder overlapping CALLs, so sends are chained.
  private outbound: Promise<unknown> | null = null;

  constructor(
    readonly socket: WebSocket,
    private readonly chargePointId: string,
    logger: Logger,
    private readonly dbLog: PluginDbLogger,
  ) {
    this.queue = new OcppMessageQueue(logger, chargePointId);
  }

  getData(): OcppLiveData {
    return this.data;
  }

  patch(delta: Partial<OcppLiveData>): void {
    this.data = {
      ...this.data,
      ...delta,
      lastUpdated: new Date().toISOString(),
    };
  }

  settle(frame: OcppFrame): boolean {
    return this.pending.settle(frame);
  }

  enqueue(job: () => Promise<void>): boolean {
    return this.queue.enqueue(job);
  }

  // Lets a refused enqueue be told apart from a full one.
  get isStopped(): boolean {
    return this.queue.isStopped;
  }

  sendRaw(message: string): void {
    this.socket.send(message);
  }

  // Every teardown path differed only in this reason string.
  close(reason: string): void {
    this.pending.rejectAll(reason);
    this.queue.stop();
    this.socket.close();
  }

  noteStoppedTransaction(transactionId: number): void {
    this.stoppedTransactionIds.add(transactionId);
  }

  hasStoppedTransaction(transactionId: number): boolean {
    return this.stoppedTransactionIds.has(transactionId);
  }

  nextTransactionId(): number {
    this.transactionCounter++;
    return this.transactionCounter;
  }

  // Keeps the counter ahead so a later StartTransaction cannot hand back an id
  // the charger already considers in use.
  reserveTransactionId(transactionId: number): void {
    this.transactionCounter = Math.max(this.transactionCounter, transactionId);
  }

  send(action: string, payload: unknown): Promise<unknown> {
    // An idle line dispatches synchronously so the CALL is on the wire (and
    // visible to callers) before any await.
    const result = this.outbound === null
      ? this.dispatch(action, payload)
      : this.afterOutbound(action, payload);
    // A predecessor's failure is already delivered to its own caller via
    // `result`; the chain only needs to know the slot freed up.
    const tail: Promise<void> = result.catch(() => null).then(() => {
      if (this.outbound === tail) this.outbound = null;
    });
    this.outbound = tail;
    return result;
  }

  private async afterOutbound(
    action: string,
    payload: unknown,
  ): Promise<unknown> {
    await this.outbound?.catch(() => null);
    return await this.dispatch(action, payload);
  }

  private async dispatch(action: string, payload: unknown): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Charger ${this.chargePointId} not connected`);
    }
    const id = crypto.randomUUID();
    this.dbLog.debug(`→ ${action} (${this.chargePointId})`, {
      payload: { chargePointId: this.chargePointId, raw: payload },
    });
    this.socket.send(OcppFraming.call(id, action, payload));
    return await this.pending.wait(id);
  }
}
