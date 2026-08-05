import { widenTrpc } from "../../../hostUi.ts";
import type { SimulatedDataOnlyAppRouter } from "../routerType.ts";

export const trpcDataOnly = widenTrpc<SimulatedDataOnlyAppRouter>();
