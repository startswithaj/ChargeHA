import type { PowerwallGatewayApi } from "../PowerwallGatewayClient.ts";

export class FakePowerwallApi implements PowerwallGatewayApi {
  readonly host = "192.0.2.10";
  aggregateResponse: unknown;
  soeResponse: unknown = { percentage: 82.4 };
  statusResponse: unknown = {
    din: "1152100-14-E--TEST",
    version: "26.10.0 test",
    device_type: "teg",
  };
  clearCalls = 0;

  constructor(aggregateResponse: unknown) {
    this.aggregateResponse = aggregateResponse;
  }

  getJson(path: string): Promise<unknown> {
    if (path === "/api/meters/aggregates") {
      return this.aggregateResponse instanceof Error
        ? Promise.reject(this.aggregateResponse)
        : Promise.resolve(this.aggregateResponse);
    }
    if (path === "/api/system_status/soe") {
      return Promise.resolve(this.soeResponse);
    }
    return Promise.reject(new Error(`Unexpected path ${path}`));
  }

  getStatus(): Promise<unknown> {
    return Promise.resolve(this.statusResponse);
  }

  clearSession(): void {
    this.clearCalls++;
  }
}

export const NOW = Date.parse("2026-08-31T01:00:00.000Z");
export const FRESH = "2026-08-31T00:59:55.000Z";
export const meter = (instantPower: number, timestamp: string = FRESH) => ({
  instant_power: instantPower,
  last_communication_time: timestamp,
});
export const aggregates = (overrides: Record<string, unknown> = {}) => ({
  site: { ...meter(-2_000.4), instant_average_voltage: 239.7 },
  solar: meter(7_500.6),
  load: meter(4_000.2),
  battery: meter(1_500.3),
  ...overrides,
});
