import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { SigenergyLocalAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SigenergyLocalAppRouter>();
