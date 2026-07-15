import { widenTrpc } from "../../../hostUi.ts";
import type { SigenergyLocalAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SigenergyLocalAppRouter>();
