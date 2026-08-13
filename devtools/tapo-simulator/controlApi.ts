// Plain-JSON control endpoints for tests — no KLAP, second port.
import type { SimulatedDevice, TapoSimulator } from "./TapoSimulator.ts";

export function handleControl(
  sim: TapoSimulator,
  req: Request,
): Promise<Response> {
  return route(sim, req);
}

async function route(sim: TapoSimulator, req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/state") {
    return Response.json(sim.device);
  }
  if (req.method === "POST" && url.pathname === "/set") {
    const patch = await req.json() as Partial<SimulatedDevice> & {
      expireSession?: boolean;
      forceMidnightReset?: boolean;
    };
    if (patch.expireSession) sim.expireSession();
    if (patch.forceMidnightReset) sim.forceMidnightReset();
    const { expireSession: _e, forceMidnightReset: _f, ...device } = patch;
    sim.applyPatch(device);
    return Response.json(sim.device);
  }
  return new Response("Not found", { status: 404 });
}
