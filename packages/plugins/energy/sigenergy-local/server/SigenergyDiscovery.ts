/// <reference lib="deno.ns" />
import { Buffer } from "node:buffer";
import type { Logger } from "@chargeha/server/lib/Logger";
import { NetworkDiscovery } from "../../NetworkDiscovery.ts";
import {
  JsmodbusReader,
  type ModbusReader,
  type ModbusTimeouts,
} from "./SigenergyModbusClient.ts";

export type SigenergyDevice = {
  host: string;
  name: string;
  model: string;
  serial: string;
};

/** Builds a `ModbusReader` for one host — injected so tests supply a fake. */
export type ReaderFactory = (
  host: string,
  port: number,
  unitIds: number[],
) => ModbusReader;

// Fingerprint registers (0x04): plant registers answer on unit 247, per-device on unit 1.
const PLANT_PV_POWER = 30035; // int32 — probed only for liveness on unit 247
const DEVICE_MODEL_TYPE = 30500; // string, 15 registers
const DEVICE_SERIAL = 30515; // string, 10 registers

const DEFAULT_PLANT_UNIT_ID = 247;
const DEFAULT_DEVICE_UNIT_ID = 1;
const DEFAULT_PORT = 502;

// Short timeouts keep a /24 sweep from stalling; only silent hosts wait out the connect timeout.
const DISCOVERY_TIMEOUTS: ModbusTimeouts = { connectMs: 1500, readMs: 1500 };

/** Decode NUL-padded ASCII packed two chars per register. */
function readAsciiString(buf: Buffer): string {
  return buf.toString("latin1").replace(/[^\x20-\x7e]/g, "").trim();
}

/**
 * Fingerprint check: is this model string a Sigenergy device? Matches the
 * `Sigen` prefix case-insensitively, covering both the `SigenStor` battery line
 * and the `Sigenergy Neo` — while excluding other Modbus vendors on port 502.
 */
export function isSigenergyModel(model: string): boolean {
  return /sigen/i.test(model);
}

class SigenergyDiscovery extends NetworkDiscovery<SigenergyDevice> {
  // Every probe is a full TCP handshake, so stop once an inverter is found.
  protected readonly stopAtFirstHit = true;

  constructor(
    logger: Logger,
    subnet?: string,
    private readonly port: number = DEFAULT_PORT,
    command: typeof Deno.Command = Deno.Command,
    networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
    private readonly makeReader: ReaderFactory | null = null,
  ) {
    super(logger, "Sigenergy discovery", subnet, command, networkInterfaces);
  }

  private readerFor(host: string, unitIds: number[]): ModbusReader {
    if (this.makeReader) return this.makeReader(host, this.port, unitIds);
    return new JsmodbusReader(
      host,
      this.port,
      unitIds,
      this.logger,
      undefined,
      DISCOVERY_TIMEOUTS,
    );
  }

  /**
   * Probe one host. A device qualifies as Sigenergy only if it BOTH answers the
   * plant PV register on unit 247 (the unusual plant unit id) AND returns a
   * `Sigen`-prefixed model string on the device unit — so a generic Modbus
   * device that merely has port 502 open is rejected.
   */
  protected async probeHost(host: string): Promise<SigenergyDevice | null> {
    const reader = this.readerFor(host, [
      DEFAULT_PLANT_UNIT_ID,
      DEFAULT_DEVICE_UNIT_ID,
    ]);
    try {
      await reader.connect();
      await reader.readInputRegisters(DEFAULT_PLANT_UNIT_ID, PLANT_PV_POWER, 2);
      const model = readAsciiString(
        await reader.readInputRegisters(
          DEFAULT_DEVICE_UNIT_ID,
          DEVICE_MODEL_TYPE,
          15,
        ),
      );
      if (!isSigenergyModel(model)) {
        this.logger.info(
          `${this.label}: ${host} — Modbus device but not Sigenergy (model "${model}")`,
        );
        return null;
      }
      return {
        host,
        name: model,
        model,
        serial: await this.readSerial(reader),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.info(`${this.label}: ${host} — ${reason}`);
      return null;
    } finally {
      await reader.disconnect();
    }
  }

  /** Serial is best-effort — a failure here doesn't disqualify the device. */
  private async readSerial(reader: ModbusReader): Promise<string> {
    try {
      return readAsciiString(
        await reader.readInputRegisters(
          DEFAULT_DEVICE_UNIT_ID,
          DEVICE_SERIAL,
          10,
        ),
      );
    } catch (err) {
      this.logger.info(`${this.label}: serial read failed (${err})`);
      return "";
    }
  }
}

/** Scan the local network for Sigenergy inverters/batteries over Modbus TCP. */
export function discoverSigenergy(
  logger: Logger,
  subnet?: string,
  port: number = DEFAULT_PORT,
  command: typeof Deno.Command = Deno.Command,
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
  makeReader?: ReaderFactory,
): Promise<SigenergyDevice[]> {
  return new SigenergyDiscovery(
    logger,
    subnet,
    port,
    command,
    networkInterfaces,
    makeReader ?? null,
  ).discover();
}
