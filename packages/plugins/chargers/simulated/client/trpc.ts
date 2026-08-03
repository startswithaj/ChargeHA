import { widenTrpc } from "../../../hostUi.ts";
import type { SimulatedChargerAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SimulatedChargerAppRouter>();
