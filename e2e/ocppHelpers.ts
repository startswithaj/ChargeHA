import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { OcppAppRouter } from "../packages/plugins/chargers/ocpp/routerType.ts";
import { APP_URL, waitFor } from "./helpers.ts";

export const SAP_UI_URL = Deno.env.get("E2E_SAP_UI_URL") ??
  "ws://localhost:19998";
const SAP_UI_USERNAME = "admin";
const SAP_UI_PASSWORD = "admin";
// The station id baked into devtools/sap-ocpp-simulator/config/e2e/station-templates/sap-test.station-template.json
// (baseName + fixedName: true).
export const SAP_STATION_ID = "sap-test";

// The second station (devtools/sap-ocpp-simulator/config/e2e/station-templates/sap-basic.station-template.json): reports
// only the energy register, on a 60s interval. sap-test already reports
// every measurand we ask for, so it is this one that exercises negotiation.
export const SAP_BASIC_STATION_ID = "sap-basic";

export const ocppTrpc = createTRPCClient<OcppAppRouter>({
  links: [httpBatchLink({ url: `${APP_URL}/trpc` })],
});

// Shared connection to the SAP simulator's UI server (ws, subprotocol `ui0.0.1`).
// Wire format: request `[uuid, procedureName, payload]`, response `[uuid, responsePayload]`.
// Auth rides as a second subprotocol entry: `authorization.basic.<base64(user:pass) no padding>`.
class SapUiClient {
  private ws: Promise<WebSocket> | undefined;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private connect(): Promise<WebSocket> {
    const encoded = btoa(`${SAP_UI_USERNAME}:${SAP_UI_PASSWORD}`).replace(
      /={1,2}$/,
      "",
    );
    const ws = new WebSocket(SAP_UI_URL, [
      "ui0.0.1",
      `authorization.basic.${encoded}`,
    ]);
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(ws), { once: true });
      ws.addEventListener("error", () => {
        reject(new Error(`SAP UI server connection failed: ${SAP_UI_URL}`));
      }, { once: true });
      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as
          | [string, unknown]
          | [unknown];
        if (message.length !== 2) return; // notifications (length 1) — unused here
        const [uuid, responsePayload] = message;
        const handler = this.pending.get(uuid as string);
        if (!handler) return;
        this.pending.delete(uuid as string);
        handler.resolve(responsePayload);
      });
      ws.addEventListener("close", () => {
        this.ws = undefined;
      }, { once: true });
    });
  }

  private async getWs(): Promise<WebSocket> {
    // Retry rather than connect once: `compose up --wait` returns as soon as
    // the container is healthy, but the ui-server binds its port a moment
    // later, so the very first connection of a run would otherwise fail
    // outright and take the whole suite's beforeAll with it.
    this.ws ??= waitFor(() => this.connect().catch(() => null), {
      timeoutMs: 30_000,
      intervalMs: 500,
      label: `SAP UI server at ${SAP_UI_URL}`,
    });
    try {
      return await this.ws;
    } catch (e) {
      this.ws = undefined;
      throw e;
    }
  }

  async request<T = Record<string, unknown>>(
    procedureName: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const ws = await this.getWs();
    const uuid = crypto.randomUUID();
    const result = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(uuid);
        reject(new Error(`SAP UI request '${procedureName}' timed out`));
      }, 10_000);
      this.pending.set(uuid, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
    });
    ws.send(JSON.stringify([uuid, procedureName, payload]));
    return await result;
  }
}

const sapUi = new SapUiClient();

// hashIds — not charge point ids — are how the SAP UI server targets a
// station on every broadcast procedure. Resolved lazily (and not cached):
// the e2e stack's stations restart independently of the test process.
function sapHashId(stationId: string = SAP_STATION_ID): Promise<string> {
  // Polled, not read once: the ui-server answers before the simulator has
  // finished spawning its stations from the template, so the first listing of
  // a run can legitimately come back empty.
  return waitFor(async () => {
    const res = await sapUi.request<
      {
        chargingStations: {
          stationInfo: { chargingStationId: string; hashId: string };
        }[];
      }
    >("listChargingStations", {});
    return res.chargingStations.find((s) =>
      s.stationInfo.chargingStationId === stationId
    )?.stationInfo.hashId;
  }, {
    timeoutMs: 30_000,
    intervalMs: 500,
    label: `SAP station '${stationId}' to appear`,
  });
}

// Forces the SAP station to reopen its socket now, skipping its ~30s reconnect backoff —
// no charger row exists at stack startup, so the app 404s the station's first connect attempt.
// openConnection's response status is meaningless (SAP's classifier has no case for it); ignored — caller polls connected-status instead.
export async function sapReconnect(
  stationId: string = SAP_STATION_ID,
): Promise<void> {
  const hashId = await sapHashId(stationId);
  // Close first: openConnection on a live socket opens a duplicate and feeds
  // the app's attach()-eviction 30s reconnect loop (see ocpp.e2e.test.ts
  // beforeAll). closeConnection is a no-op when already down.
  await sapUi.request("closeConnection", { hashIds: [hashId] });
  await sapUi.request("openConnection", { hashIds: [hashId] });
}

// The station's own view of one OCPP config key — proves a ChangeConfiguration actually
// landed, not just that it was answered `Accepted`. Undefined if the station lacks the key.
export async function sapConfigValue(
  stationId: string,
  key: string,
): Promise<string | undefined> {
  const res = await sapUi.request<
    {
      chargingStations: {
        stationInfo: { chargingStationId: string };
        ocppConfiguration: {
          configurationKey?: { key: string; value?: string }[];
        };
      }[];
    }
  >("listChargingStations", {});
  const station = res.chargingStations.find((s) =>
    s.stationInfo.chargingStationId === stationId
  );
  return station?.ocppConfiguration.configurationKey
    ?.find((k) => k.key === key)?.value;
}

// Connector 1's transaction state as the STATION holds it. The app's own
// charger state only shows what it believes; this is what actually happened
// on the wire, so a RemoteStart/RemoteStop that was never sent cannot pass.
export async function sapTransactionStarted(
  stationId: string = SAP_STATION_ID,
): Promise<boolean> {
  const res = await sapUi.request<
    {
      chargingStations: {
        stationInfo: { chargingStationId: string };
        connectors: {
          connectorId: number;
          connectorStatus: { transactionStarted?: boolean };
        }[];
      }[];
    }
  >("listChargingStations", {});
  const station = res.chargingStations.find((s) =>
    s.stationInfo.chargingStationId === stationId
  );
  return station?.connectors.find((c) => c.connectorId === 1)
    ?.connectorStatus.transactionStarted === true;
}

// Injects a charger-initiated OCPP message via the SAP UI server, replacing vcp's
// `POST /execute`. SAP has no such endpoint — each message type is its own UI procedure,
// broadcast by hashId. `action` is mapped from vcp's PascalCase to the procedure's camelCase.
export async function vcpSend(
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const procedureName = action.charAt(0).toLowerCase() + action.slice(1);
  const hashId = await sapHashId();
  const response = await sapUi.request<
    { status: string; errorMessage?: string }
  >(
    procedureName,
    { ...payload, hashIds: [hashId] },
  );
  if (response.status !== "success") {
    throw new Error(
      `SAP UI ${action} failed: ${response.errorMessage ?? response.status}`,
    );
  }
}

export function meterValuesPayload(
  powerW: number,
  energyWh: number,
  transactionId?: number,
) {
  return {
    connectorId: 1,
    ...(transactionId !== undefined && { transactionId }),
    meterValue: [{
      timestamp: new Date().toISOString(),
      sampledValue: [
        { value: String(powerW), measurand: "Power.Active.Import", unit: "W" },
        {
          value: String(energyWh),
          measurand: "Energy.Active.Import.Register",
          unit: "Wh",
        },
        { value: "240", measurand: "Voltage", unit: "V" },
        { value: String(powerW / 240), measurand: "Current.Import", unit: "A" },
      ],
    }],
  };
}
