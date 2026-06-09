import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { SimulatedEnergyAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SimulatedEnergyAppRouter>();
