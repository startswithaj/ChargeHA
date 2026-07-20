import { widenTrpc } from "../../../hostUi.ts";
import type { SimulatedEnergyAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SimulatedEnergyAppRouter>();
