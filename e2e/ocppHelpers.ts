import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { OcppAppRouter } from "../packages/plugins/chargers/ocpp/routerType.ts";
import { APP_URL } from "./helpers.ts";

export const VCP_ADMIN_URL = Deno.env.get("E2E_VCP_ADMIN_URL") ??
  "http://localhost:19999";

export const ocppTrpc = createTRPCClient<OcppAppRouter>({
  links: [httpBatchLink({ url: `${APP_URL}/trpc` })],
});

/** Inject a charger-initiated OCPP message via the vcp admin API
 *  (POST /execute with { action, payload } — verified in admin/admin.ts). */
export async function vcpSend(
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${VCP_ADMIN_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`vcp admin ${action} failed: ${res.status}`);
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
