import { widenTrpc } from "../../../hostUi.ts";
import type { FroniusCloudAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<FroniusCloudAppRouter>();
