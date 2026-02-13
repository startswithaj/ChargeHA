import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { FroniusCloudAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<FroniusCloudAppRouter>();
