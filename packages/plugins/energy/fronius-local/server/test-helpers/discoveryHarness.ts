import type { Logger } from "@chargeha/server/lib/Logger";
import { discoverFronius } from "../FroniusDiscovery.ts";

export interface DiscoveryStubs {
  setArpOutput(out: string): void;
  setArpThrows(v: boolean): void;
  setInterfaces(ifs: Deno.NetworkInterfaceInfo[]): void;
  setInterfacesThrow(v: boolean): void;
  /** Run discovery with the fake `arp` command + network interfaces injected. */
  discover(logger: Logger, subnet?: string): ReturnType<typeof discoverFronius>;
}

export const installDiscoveryStubs = (): DiscoveryStubs => {
  const state = {
    arpOutput: "",
    arpShouldThrow: false,
    networkInterfacesResult: [] as Deno.NetworkInterfaceInfo[],
    networkInterfacesShouldThrow: false,
  };

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
    discover: (logger, subnet) =>
      discoverFronius(logger, subnet, command, networkInterfaces),
  };
};
