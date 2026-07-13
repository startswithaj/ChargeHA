import type { Logger } from "@chargeha/server/lib/Logger";
import type { ModbusReader } from "../SigenergyModbusClient.ts";
import { discoverSigenergy, type ReaderFactory } from "../discovery.ts";
import { FakeModbusReader } from "./sigenergyModbusHarness.ts";

const PLANT_UNIT = 247;
const DEVICE_UNIT = 1;
const PLANT_PV_POWER = 30035;
const MODEL_TYPE = 30500;
const SERIAL = 30515;

/** How a fake device at a given host responds to the discovery probe. */
export interface FakeDevice {
  /** Model string returned on the device unit (30500). */
  model: string;
  /** Serial returned on the device unit (30515); unset = read fails. */
  serial?: string;
  /** Whether the plant unit (247) answers the liveness read. Default true. */
  plant?: boolean;
}

export interface SigenergyDiscoveryStubs {
  setArpOutput(out: string): void;
  setArpThrows(v: boolean): void;
  setInterfaces(ifs: Deno.NetworkInterfaceInfo[]): void;
  setInterfacesThrow(v: boolean): void;
  /** Make a Modbus device reachable at `host` (Sigenergy or otherwise). */
  setDevice(host: string, device: FakeDevice): void;
  discover(
    logger: Logger,
    subnet?: string,
  ): ReturnType<typeof discoverSigenergy>;
}

/** A reader for a host with nothing listening on port 502. */
const unreachableReader = (host: string): ModbusReader => ({
  connect: () =>
    Promise.reject(new Error(`Cannot reach Sigenergy at ${host}:502`)),
  disconnect: () => Promise.resolve(),
  readInputRegisters: () => Promise.reject(new Error("not connected")),
});

/** A `FakeModbusReader` seeded to answer the probe like the given device. */
const deviceReader = (device: FakeDevice): ModbusReader => {
  const reader = new FakeModbusReader();
  reader.setString(DEVICE_UNIT, MODEL_TYPE, device.model, 15);
  if (device.serial !== undefined) {
    reader.setString(DEVICE_UNIT, SERIAL, device.serial, 10);
  }
  if (device.plant ?? true) {
    reader.setS32(PLANT_UNIT, PLANT_PV_POWER, 3196);
  } else {
    reader.failAt(PLANT_UNIT, PLANT_PV_POWER);
  }
  return reader;
};

export const installSigenergyDiscoveryStubs = (): SigenergyDiscoveryStubs => {
  const state = {
    arpOutput: "",
    arpShouldThrow: false,
    networkInterfacesResult: [] as Deno.NetworkInterfaceInfo[],
    networkInterfacesShouldThrow: false,
  };
  const devices = new Map<string, FakeDevice>();

  const command = class {
    constructor(_cmd: string | URL, _opts?: Deno.CommandOptions) {}
    output() {
      if (state.arpShouldThrow) throw new Error("arp not available");
      return {
        stdout: new TextEncoder().encode(state.arpOutput),
        stderr: new Uint8Array(),
      };
    }
  } as unknown as typeof Deno.Command;

  const networkInterfaces = (() => {
    if (state.networkInterfacesShouldThrow) throw new Error("not available");
    return state.networkInterfacesResult;
  }) as typeof Deno.networkInterfaces;

  const makeReader: ReaderFactory = (host) => {
    const device = devices.get(host);
    return device ? deviceReader(device) : unreachableReader(host);
  };

  return {
    setArpOutput: (out) => {
      state.arpOutput = out;
    },
    setArpThrows: (v) => {
      state.arpShouldThrow = v;
    },
    setInterfaces: (ifs) => {
      state.networkInterfacesResult = ifs;
    },
    setInterfacesThrow: (v) => {
      state.networkInterfacesShouldThrow = v;
    },
    setDevice: (host, device) => {
      devices.set(host, device);
    },
    discover: (logger, subnet) =>
      discoverSigenergy(
        logger,
        subnet,
        502,
        command,
        networkInterfaces,
        makeReader,
      ),
  };
};
