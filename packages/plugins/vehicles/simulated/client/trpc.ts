import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { SimulatedAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SimulatedAppRouter>();
