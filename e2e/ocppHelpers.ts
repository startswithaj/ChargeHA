import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { OcppAppRouter } from "../packages/plugins/chargers/ocpp/routerType.ts";
import { APP_URL } from "./helpers.ts";

export const SAP_UI_URL = Deno.env.get("E2E_SAP_UI_URL") ??
  "ws://localhost:19998";
const SAP_UI_USERNAME = "admin";
const SAP_UI_PASSWORD = "admin";
// The station id baked into docker/sap-e2e/station-template.json
// (baseName + fixedName: true).
const SAP_STATION_ID = "vcp-test";

export const ocppTrpc = createTRPCClient<OcppAppRouter>({
  links: [httpBatchLink({ url: `${APP_URL}/trpc` })],
});

/** One shared connection to the SAP simulator's UI server (ws, subprotocol
 *  `ui0.0.1`), reused across calls in a test run. Wire format verified
 *  against the pinned SAP source (src/charging-station/ui-server/): request
 *  `[uuid, procedureName, payload]`, response `[uuid, responsePayload]`.
 *  Auth is `protocol-basic-auth`: credentials ride as a second subprotocol
 *  entry, `authorization.basic.<base64(user:pass) without padding>`
 *  (ui/common/src/client/WebSocketClient.ts is the reference implementation). */
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
    this.ws ??= this.connect();
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

/** hashIds — not charge point ids — are how the SAP UI server targets a
 *  station on every broadcast procedure. Resolved lazily (and not cached):
 *  the e2e stack's stations restart independently of the test process. */
async function sapHashId(): Promise<string> {
  const res = await sapUi.request<
    {
      chargingStations: {
        stationInfo: { chargingStationId: string; hashId: string };
      }[];
    }
  >("listChargingStations", {});
  const station = res.chargingStations.find((s) =>
    s.stationInfo.chargingStationId === SAP_STATION_ID
  );
  if (!station) {
    throw new Error(
      `SAP simulator has no station with id '${SAP_STATION_ID}'`,
    );
  }
  return station.stationInfo.hashId;
}

/** Inject a charger-initiated OCPP message via the SAP UI server. Replaces
 *  vcp's `POST /execute {action, payload}` — the SAP simulator has no such
 *  endpoint; instead each OCPP message type is its own UI procedure
 *  (`statusNotification`, `meterValues`, ...), broadcast to a station by
 *  hashId (see `sapHashId`). `action` here is the OCPP message name in the
 *  vcp/PascalCase form the tests already use; mapped to the SAP procedure's
 *  camelCase name. */
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
