import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { TeslaAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<TeslaAppRouter>();
