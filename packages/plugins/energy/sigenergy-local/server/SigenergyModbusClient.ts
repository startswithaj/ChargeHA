import { Buffer } from "node:buffer";
import { Socket } from "node:net";
import jsmodbus from "jsmodbus";
import type { Logger } from "@chargeha/server/lib/Logger";

const CONNECT_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 5000;

/** Per-reader connect/read timeout overrides. Network discovery uses short
 *  values so a full subnet sweep doesn't stall on silent hosts. */
export interface ModbusTimeouts {
  connectMs: number;
  readMs: number;
}

export class SigenergyConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "SigenergyConnectionError";
  }
}

/**
 * Minimal Modbus read surface the adapter depends on. Implemented by
 * `JsmodbusReader` in production and by a fake in tests, so the adapter's
 * register-decoding logic can be exercised without a real socket.
 */
export interface ModbusReader {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Read `count` input registers (function code 0x04) starting at `address`
   * from the given Modbus unit id. Resolves with the raw big-endian register
   * bytes (2 bytes per register).
   */
  readInputRegisters(
    unitId: number,
    address: number,
    count: number,
  ): Promise<Buffer>;
}

export type SocketFactory = () => Socket;

/** The slice of jsmodbus's client we use — its Deno types are loose. */
interface ModbusTcpClient {
  readInputRegisters(
    address: number,
    count: number,
  ): Promise<{ response: { body: { valuesAsBuffer: Buffer } } }>;
}

/**
 * `ModbusReader` backed by `jsmodbus` over a single `node:net` TCP socket.
 *
 * Sigenergy exposes plant/EMS registers on one unit id (default 247) and
 * per-device registers on another (default 1). jsmodbus binds the unit id at
 * client construction, so `connect()` builds one client per configured unit id
 * (all sharing the one socket) before the socket connects — see the note there.
 */
export class JsmodbusReader implements ModbusReader {
  private socket: Socket | null = null;
  private clients = new Map<number, ModbusTcpClient>();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly unitIds: readonly number[],
    private readonly logger: Logger,
    private readonly socketFactory: SocketFactory = () => new Socket(),
    private readonly timeouts: ModbusTimeouts = {
      connectMs: CONNECT_TIMEOUT_MS,
      readMs: READ_TIMEOUT_MS,
    },
  ) {}

  connect(): Promise<void> {
    const socket = this.socketFactory();
    this.socket = socket;
    // Construct one jsmodbus client per unit id BEFORE connecting the socket.
    // jsmodbus latches its "online" state from the socket's `connect` event, so
    // a client created after the socket has already connected rejects every
    // read with "no connection to modbus server".
    this.clients = new Map(
      [...new Set(this.unitIds)].map(
        (
          unitId,
        ) => [
          unitId,
          new jsmodbus.client.TCP(socket, unitId) as ModbusTcpClient,
        ],
      ),
    );
    return new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        // Keep a persistent error handler for the socket's lifetime — an
        // unhandled 'error' event (e.g. ECONNRESET when the inverter reboots)
        // would otherwise crash the process.
        socket.on("error", (err: Error) => {
          this.logger.warn(`Sigenergy socket error: ${err.message}`);
        });
        this.logger.info(`Connected to Sigenergy at ${this.host}:${this.port}`);
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(
          new SigenergyConnectionError(
            `Cannot reach Sigenergy at ${this.host}:${this.port}`,
            err,
          ),
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        socket.destroy();
        reject(
          new SigenergyConnectionError(
            `Timed out connecting to Sigenergy at ${this.host}:${this.port}`,
          ),
        );
      }, this.timeouts.connectMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
      socket.connect({ host: this.host, port: this.port });
    });
  }

  disconnect(): Promise<void> {
    this.socket?.destroy();
    this.socket = null;
    this.clients = new Map();
    return Promise.resolve();
  }

  async readInputRegisters(
    unitId: number,
    address: number,
    count: number,
  ): Promise<Buffer> {
    const client = this.clientFor(unitId);
    try {
      const resp = await this.withTimeout(
        client.readInputRegisters(address, count),
        `read ${count} register(s) at ${address} (unit ${unitId})`,
      );
      return resp.response.body.valuesAsBuffer;
    } catch (err) {
      if (err instanceof SigenergyConnectionError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new SigenergyConnectionError(
        `Modbus read failed at ${address} (unit ${unitId}): ${reason}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  private clientFor(unitId: number): ModbusTcpClient {
    if (!this.socket) {
      throw new SigenergyConnectionError("Modbus socket is not connected");
    }
    const client = this.clients.get(unitId);
    if (!client) {
      throw new SigenergyConnectionError(
        `No Modbus client for unit ${unitId} — not configured at connect time`,
      );
    }
    return client;
  }

  private withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SigenergyConnectionError(`Timed out on Modbus ${what}`));
      }, this.timeouts.readMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}
