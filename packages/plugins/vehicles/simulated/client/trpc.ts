import { widenTrpc } from "../../../hostUi.ts";
import type { SimulatedAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SimulatedAppRouter>();
