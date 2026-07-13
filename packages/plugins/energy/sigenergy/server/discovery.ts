/// <reference lib="deno.ns" />
import { Buffer } from "node:buffer";
import type { Logger } from "@chargeha/server/lib/Logger";
import {
  chunk,
  expandArpToSubnets,
  extractSubnets,
  generateSubnetIps,
  parseArpOutput,
} from "../../networkScan.ts";
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

// ── Fingerprint registers (input registers, function code 0x04) ─────────────
// Same addresses the adapter uses. Plant/EMS registers answer on the plant unit
// id (default 247); per-device registers answer on the device unit id (1).
const PLANT_PV_POWER = 30035; // int32 — probed only for liveness on unit 247
const DEVICE_MODEL_TYPE = 30500; // string, 15 registers
const DEVICE_SERIAL = 30515; // string, 10 registers

const DEFAULT_PLANT_UNIT_ID = 247;
const DEFAULT_DEVICE_UNIT_ID = 1;
const DEFAULT_PORT = 502;
const BATCH_SIZE = 30;

// Short timeouts keep a full /24 sweep from stalling on silent hosts. A device
// that isn't listening on 502 refuses the TCP connection near-instantly; only
// firewalled/silent hosts wait out the connect timeout.
const DISCOVERY_TIMEOUTS: ModbusTimeouts = { connectMs: 1500, readMs: 1500 };

// ── Pure helpers ────────────────────────────────────────────────────────────

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

// ── Discovery class ─────────────────────────────────────────────────────────

class SigenergyDiscovery {
  constructor(
    private readonly logger: Logger,
    private readonly subnet?: string,
    private readonly port: number = DEFAULT_PORT,
    // Injected so tests can supply fakes instead of patching Deno globals.
    private readonly command: typeof Deno.Command = Deno.Command,
    private readonly networkInterfaces: typeof Deno.networkInterfaces =
      Deno.networkInterfaces,
    private readonly makeReader: ReaderFactory | null = null,
  ) {}

  async discover(): Promise<SigenergyDevice[]> {
    const candidates = await this.buildCandidates();
    this.logger.info(
      `Sigenergy discovery: probing ${candidates.length} IPs on port ${this.port} in batches of ${BATCH_SIZE}`,
    );
    const found = await this.probeBatches(candidates);
    this.logger.info(
      `Sigenergy discovery: complete — ${found.length} device(s) found`,
    );
    return found;
  }

  private async buildCandidates(): Promise<string[]> {
    if (this.subnet) {
      const cleanSubnet = this.subnet.replace(/\.$/, "");
      this.logger.info(`Sigenergy discovery: scanning subnet ${cleanSubnet}.*`);
      return generateSubnetIps(cleanSubnet);
    }

    const arpIps = await this.getArpIps();
    if (arpIps.length > 0) {
      this.logger.info(
        `Sigenergy discovery: ARP table returned ${arpIps.length} candidate(s): ${
          arpIps.join(", ")
        }`,
      );
      const candidates = expandArpToSubnets(arpIps);
      this.logger.info(
        `Sigenergy discovery: expanded ARP subnets [${
          extractSubnets(arpIps).join(", ")
        }] to ${candidates.length} total candidates`,
      );
      return candidates;
    }

    const candidates = this.candidatesFromInterfaces();
    this.logger.info(
      `Sigenergy discovery: ${candidates.length} candidates from interface detection`,
    );
    return candidates;
  }

  private async getArpIps(): Promise<string[]> {
    try {
      const proc = new this.command("arp", {
        args: ["-a"],
        stdout: "piped",
        stderr: "piped",
      });
      const { stdout } = await proc.output();
      return parseArpOutput(new TextDecoder().decode(stdout));
    } catch (err) {
      this.logger.info(
        `Sigenergy discovery: arp unavailable (${err}), falling back to interface detection`,
      );
      return [];
    }
  }

  /** Detect subnets from network interfaces, or fall back to 192.168.1.*. */
  private candidatesFromInterfaces(): string[] {
    try {
      const subnets = extractSubnets(
        this.networkInterfaces()
          .filter((iface) =>
            iface.family === "IPv4" && !iface.address.startsWith("127.")
          )
          .map((iface) => iface.address),
      );
      return subnets.flatMap(generateSubnetIps);
    } catch (err) {
      this.logger.info(
        `Sigenergy discovery: interface detection failed (${err}), falling back to 192.168.1.*`,
      );
      return generateSubnetIps("192.168.1");
    }
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
  private async probeHost(host: string): Promise<SigenergyDevice | null> {
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
          `Sigenergy discovery: ${host} — Modbus device but not Sigenergy (model "${model}")`,
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
      this.logger.info(`Sigenergy discovery: ${host} — ${reason}`);
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
      this.logger.info(`Sigenergy discovery: serial read failed (${err})`);
      return "";
    }
  }

  /**
   * Probe candidates batch by batch, stopping at the first batch that turns up
   * a Sigenergy device. ChargeHA supports a single inverter, so there's no
   * value in scanning the rest of the subnet once one is found — we return that
   * device and skip the remaining batches.
   */
  private probeBatches(candidates: string[]): Promise<SigenergyDevice[]> {
    return this.probeBatchesFrom(chunk(candidates, BATCH_SIZE), 0);
  }

  private async probeBatchesFrom(
    batches: string[][],
    index: number,
  ): Promise<SigenergyDevice[]> {
    if (index >= batches.length) return [];
    const results = await Promise.allSettled(
      batches[index].map((host) => this.probeHost(host)),
    );
    const hit = results
      .filter(
        (r): r is PromiseFulfilledResult<SigenergyDevice> =>
          r.status === "fulfilled" && r.value != null,
      )
      .map((r) => r.value)[0];
    if (hit) {
      this.logger.info(
        `Sigenergy discovery: found ${hit.name} at ${hit.host}, stopping scan`,
      );
      // Just return the first device found to speed up discovery. How likely is it that a user would have multiple 
      // Sigenergy inverters?? If they do, they will have to specify the host manually. They are clearly an edge case!
      return [hit];
    }
    return this.probeBatchesFrom(batches, index + 1);
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
