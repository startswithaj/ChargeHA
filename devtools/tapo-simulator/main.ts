// Container entrypoint: device API on 80, control API on 8081.
// In-process tests import startTapoSimulator() instead.
import { TapoSimulator } from "./TapoSimulator.ts";
import { handleControl } from "./controlApi.ts";

export interface RunningSimulator {
  sim: TapoSimulator;
  devicePort: number;
  controlPort: number;
  stop: () => Promise<void>;
}

export function startTapoSimulator(
  { devicePort = 0, controlPort = 0 } = {},
): RunningSimulator {
  const sim = new TapoSimulator();
  const device = Deno.serve(
    { port: devicePort },
    (req) => sim.handle(req),
  );
  const control = Deno.serve(
    { port: controlPort },
    (req) => handleControl(sim, req),
  );
  return {
    sim,
    devicePort: device.addr.port,
    controlPort: control.addr.port,
    stop: async () => {
      await device.shutdown();
      await control.shutdown();
    },
  };
}

if (import.meta.main) {
  startTapoSimulator({ devicePort: 80, controlPort: 8081 });
  console.log("tapo-simulator: device on :80, control on :8081");
}
