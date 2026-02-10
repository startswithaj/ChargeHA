import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { FroniusLocalAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<FroniusLocalAppRouter>();
