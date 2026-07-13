import type { Logger } from "@chargeha/server/lib/Logger";
import type { EnvoyHttp } from "../EnphaseClient.ts";
import { discoverEnphase } from "../EnphaseDiscovery.ts";

/** How a fake device at a given host answers the `/info` probe. */
export interface FakeInfoDevice {
  serial: string;
  model?: string;
  /** Raw body override for non-Envoy HTTP devices. */
  rawBody?: string;
}

export interface EnphaseDiscoveryStubs {
  setArpOutput(out: string): void;
  setInterfaces(ifs: Deno.NetworkInterfaceInfo[]): void;
  /** Make a device reachable at `host` (Envoy or otherwise). */
  setDevice(host: string, device: FakeInfoDevice): void;
  discover(logger: Logger, subnet?: string): ReturnType<typeof discoverEnphase>;
}

const infoXml = (device: FakeInfoDevice): string =>
  device.rawBody ??
    `<envoy_info><device><sn>${device.serial}</sn><pn>${
      device.model ?? "800-00654-r08"
    }</pn></device></envoy_info>`;

export const installEnphaseDiscoveryStubs = (): EnphaseDiscoveryStubs => {
  const state = {
    arpOutput: "",
    networkInterfacesResult: [] as Deno.NetworkInterfaceInfo[],
  };
  const devices = new Map<string, FakeInfoDevice>();

  const command = class {
    constructor(_cmd: string | URL, _opts?: Deno.CommandOptions) {}
    output() {
      return {
        stdout: new TextEncoder().encode(state.arpOutput),
        stderr: new Uint8Array(),
      };
    }
  } as unknown as typeof Deno.Command;

  const networkInterfaces =
    (() => state.networkInterfacesResult) as typeof Deno.networkInterfaces;

  const http: EnvoyHttp = {
    get: (host, _path, _headers) => {
      const device = devices.get(host);
      return device
        ? Promise.resolve({ status: 200, body: infoXml(device) })
        : Promise.reject(new Error(`connect ECONNREFUSED ${host}:443`));
    },
  };

  return {
    setArpOutput: (out) => {
      state.arpOutput = out;
    },
    setInterfaces: (ifs) => {
      state.networkInterfacesResult = ifs;
    },
    setDevice: (host, device) => {
      devices.set(host, device);
    },
    discover: (logger, subnet) =>
      discoverEnphase(logger, subnet, command, networkInterfaces, http),
  };
};
