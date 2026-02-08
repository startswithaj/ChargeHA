/**
 * Generic record-and-replay event emitter for tests. Captures emitted events
 * in `events` and fires registered listeners synchronously. Use for
 * VehicleManager / EnergyPoller / vehicles router tests where they need a
 * non-real emitter.
 */
export class MockEventEmitter {
  events: Array<{ type: string; data: unknown }> = [];
  listeners: Array<{ type: string; fn: (data: unknown) => void }> = [];

  emit(type: string, data: unknown): void {
    this.events.push({ type, data });
    this.listeners
      .filter((l) => l.type === type)
      .forEach((l) => l.fn(data));
  }

  subscribe(
    type: string,
    listener: (data: unknown) => void,
  ): () => void {
    const entry = { type, fn: listener };
    this.listeners.push(entry);
    return () => {
      const i = this.listeners.indexOf(entry);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}
