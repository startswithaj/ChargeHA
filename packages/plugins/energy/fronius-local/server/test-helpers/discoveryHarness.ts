export interface DiscoveryStubs {
  setArpOutput(out: string): void;
  setArpThrows(v: boolean): void;
  setInterfaces(ifs: Deno.NetworkInterfaceInfo[]): void;
  setInterfacesThrow(v: boolean): void;
  restore(): void;
}

const setDenoGlobal = <K extends keyof typeof Deno>(
  key: K,
  value: typeof Deno[K],
): typeof Deno[K] => {
  const original = Deno[key];
  (Deno as Record<string, unknown>)[key as string] = value;
  return original;
};

export const installDiscoveryStubs = (): DiscoveryStubs => {
  const state = {
    arpOutput: "",
    arpShouldThrow: false,
    networkInterfacesResult: [] as Deno.NetworkInterfaceInfo[],
    networkInterfacesShouldThrow: false,
  };

  const MockCommand = class {
    constructor(_cmd: string, _opts?: unknown) {}
    output() {
      if (state.arpShouldThrow) throw new Error("arp not available");
      return {
        stdout: new TextEncoder().encode(state.arpOutput),
        stderr: new Uint8Array(),
      };
    }
  } as unknown as typeof Deno.Command;

  const mockNetworkInterfaces = (() => {
    if (state.networkInterfacesShouldThrow) throw new Error("not available");
    return state.networkInterfacesResult;
  }) as typeof Deno.networkInterfaces;

  const originalCommand = setDenoGlobal("Command", MockCommand);
  const originalNetworkInterfaces = setDenoGlobal(
    "networkInterfaces",
    mockNetworkInterfaces,
  );

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
    restore: () => {
      setDenoGlobal("Command", originalCommand);
      setDenoGlobal("networkInterfaces", originalNetworkInterfaces);
    },
  };
};
