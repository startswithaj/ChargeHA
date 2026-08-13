// OCPP-J wire format: CALL [2, id, action, payload],
// CALLRESULT [3, id, payload], CALLERROR [4, id, code, description, details].

export type OcppFrame =
  | { kind: "call"; id: string; action: string; payload: unknown }
  | { kind: "result"; id: string; payload: unknown }
  | { kind: "error"; id: string; code: string; description: string };

export class OcppFramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcppFramingError";
  }
}

export class OcppFraming {
  static decode(raw: string): OcppFrame {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new OcppFramingError("Not an array");
    const [type, id] = parsed;
    if (typeof id !== "string") throw new OcppFramingError("Bad message id");
    if (type === 2) {
      if (typeof parsed[2] !== "string") {
        throw new OcppFramingError("CALL action must be a string");
      }
      return { kind: "call", id, action: parsed[2], payload: parsed[3] ?? {} };
    }
    if (type === 3) return { kind: "result", id, payload: parsed[2] ?? {} };
    if (type === 4) {
      return {
        kind: "error",
        id,
        code: String(parsed[2]),
        description: String(parsed[3] ?? ""),
      };
    }
    throw new OcppFramingError(`Unknown message type ${type}`);
  }

  static call(id: string, action: string, payload: unknown): string {
    return JSON.stringify([2, id, action, payload]);
  }

  static result(id: string, payload: unknown): string {
    return JSON.stringify([3, id, payload]);
  }

  static error(id: string, code: string, description: string): string {
    return JSON.stringify([4, id, code, description, {}]);
  }
}

const CALL_TIMEOUT_MS = 30_000;

// Correlates outgoing CALLs with their CALLRESULT/CALLERROR by unique id.
export class PendingCalls {
  private readonly pending = new Map<string, {
    resolve: (payload: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  wait(id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OCPP call ${id} timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  settle(frame: OcppFrame): boolean {
    if (frame.kind === "call") return false;
    const entry = this.pending.get(frame.id);
    if (!entry) return false;
    this.pending.delete(frame.id);
    clearTimeout(entry.timer);
    if (frame.kind === "result") entry.resolve(frame.payload);
    else entry.reject(new Error(`${frame.code}: ${frame.description}`));
    return true;
  }

  rejectAll(reason: string): void {
    this.pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    });
    this.pending.clear();
  }
}
