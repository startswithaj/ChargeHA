import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { SigenergyAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SigenergyAppRouter>();
