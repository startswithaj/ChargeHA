import { widenTrpc } from "../../../hostUi.ts";
import type { OcppAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<OcppAppRouter>();
