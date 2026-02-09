export interface MockResp {
  ok: boolean;
  status: number;
  json: unknown;
}

export type MatchBy = "pathContains" | "hostPrefix";

export interface FroniusFetchStub {
  fetchCalls: Array<{ url: string }>;
  /** Override the response for a given key (path substring or host). */
  setResponse(key: string, resp: MockResp): void;
  restore(): void;
}

export const defaultFroniusResponses: Record<string, unknown> = {
  GetPowerFlowRealtimeData: {
    Body: {
      Data: {
        Site: {
          P_PV: 5000,
          P_Grid: -2000,
          P_Load: -3000,
          P_Akku: null,
          SOC: null,
          E_Total: 50000,
          E_Day: 5000,
        },
      },
    },
  },
  GetMeterRealtimeData: {
    Body: {
      Data: {
        EnergyReal_WAC_Sum_Consumed: 10000,
        EnergyReal_WAC_Sum_Produced: 20000,
      },
    },
  },
  GetInverterInfo: {
    Body: {
      Data: {
        "1": { CustomName: "My Fronius", DT: 123 },
      },
    },
  },
};

const extractUrl = (input: string | URL | Request): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const buildResponse = (resp: MockResp): Response =>
  ({
    ok: resp.ok,
    status: resp.status,
    json: () => Promise.resolve(resp.json),
    text: () => Promise.resolve(JSON.stringify(resp.json)),
  }) as Response;

export const installFroniusFetchStub = (
  { matchBy }: { matchBy: MatchBy },
): FroniusFetchStub => {
  const fetchCalls: Array<{ url: string }> = [];
  const overrides = new Map<string, MockResp>();
  const originalFetch = globalThis.fetch;

  const matches = (key: string, url: string): boolean =>
    matchBy === "pathContains"
      ? url.includes(key)
      : url.startsWith(`http://${key}/`);

  globalThis.fetch = ((input: string | URL | Request) => {
    const url = extractUrl(input);
    fetchCalls.push({ url });

    const override = [...overrides].find(([key]) => matches(key, url));
    if (override) return Promise.resolve(buildResponse(override[1]));

    if (matchBy === "pathContains") {
      const hit = Object.entries(defaultFroniusResponses).find(
        ([fragment]) => url.includes(fragment),
      );
      if (hit) {
        return Promise.resolve(
          buildResponse({ ok: true, status: 200, json: hit[1] }),
        );
      }
      return Promise.resolve(
        {
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not Found"),
        } as Response,
      );
    }

    return Promise.reject(new TypeError("Connection refused"));
  }) as typeof globalThis.fetch;

  return {
    fetchCalls,
    setResponse: (key, resp) => {
      overrides.set(key, resp);
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};
