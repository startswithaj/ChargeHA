import { Buffer } from "node:buffer";
import type { ModbusReader } from "../SigenergyModbusClient.ts";

/**
 * In-memory `ModbusReader` for adapter tests. Register values are seeded by
 * type (the harness builds the big-endian bytes), keyed by `unitId:address`.
 * Addresses can be marked to fail so the adapter's defensive paths are covered.
 */
export class FakeModbusReader implements ModbusReader {
  connectCalls = 0;
  disconnectCalls = 0;
  private readonly responses = new Map<string, Buffer>();
  private readonly failures = new Set<string>();
  private readonly readCounts = new Map<string, number>();

  private key(unitId: number, address: number): string {
    return `${unitId}:${address}`;
  }

  /** How many reads (successful or failed) hit one register. Lets tests assert
   *  that values the adapter caches are only fetched once. */
  readCount(unitId: number, address: number): number {
    return this.readCounts.get(this.key(unitId, address)) ?? 0;
  }

  setS32(unitId: number, address: number, value: number): this {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(value, 0);
    this.responses.set(this.key(unitId, address), buf);
    return this;
  }

  setU16(unitId: number, address: number, value: number): this {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(value, 0);
    this.responses.set(this.key(unitId, address), buf);
    return this;
  }

  setU32(unitId: number, address: number, value: number): this {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value, 0);
    this.responses.set(this.key(unitId, address), buf);
    return this;
  }

  setString(
    unitId: number,
    address: number,
    text: string,
    registers: number,
  ): this {
    const buf = Buffer.alloc(registers * 2);
    buf.write(text, 0, "latin1");
    this.responses.set(this.key(unitId, address), buf);
    return this;
  }

  failAt(unitId: number, address: number): this {
    this.failures.add(this.key(unitId, address));
    return this;
  }

  connect(): Promise<void> {
    this.connectCalls++;
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.disconnectCalls++;
    return Promise.resolve();
  }

  readInputRegisters(
    unitId: number,
    address: number,
    _count: number,
  ): Promise<Buffer> {
    const key = this.key(unitId, address);
    this.readCounts.set(key, (this.readCounts.get(key) ?? 0) + 1);
    if (this.failures.has(key)) {
      return Promise.reject(new Error(`fake modbus failure at ${key}`));
    }
    const buf = this.responses.get(key);
    if (!buf) {
      return Promise.reject(new Error(`no fake register seeded at ${key}`));
    }
    return Promise.resolve(buf);
  }
}
