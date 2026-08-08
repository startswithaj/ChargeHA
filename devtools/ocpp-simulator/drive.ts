// Drives a steady charge rate into the OCPP simulator via its admin API.
//
// The simulator's own meter loop is disabled (DISABLE_METER_VALUES=true in
// docker-compose.yml) because it reports a hardcoded 36 kW and omits the
// Current.Import measurand that the app reads for amps. This script is then
// the only source of MeterValues, so the reported draw stays exactly what is
// asked for here.
//
// Usage: deno run -A devtools/ocpp-simulator/drive.ts [--amps=32] [--volts=240]
//                                                     [--admin=http://localhost:19999]
const flag = (name: string, fallback: number): number => {
  const raw = Deno.args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
};

const amps = flag("amps", 32);
const volts = flag("volts", 240);
const intervalSec = flag("interval", 5);
const adminUrl = Deno.args.find((a) => a.startsWith("--admin="))
  ?.split("=")[1] ?? "http://localhost:19999";

const powerW = amps * volts;
const startedAt = Date.now();

/** Energy accumulated since this script started, in Wh. The simulator no
 *  longer tracks a register of its own, so the session total is ours to keep. */
const energyWh = () => (powerW * (Date.now() - startedAt)) / 3_600_000;

const send = async () => {
  const res = await fetch(`${adminUrl}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "MeterValues",
      payload: {
        connectorId: 1,
        // 0 is the upstream placeholder: the simulator substitutes the real id
        // when exactly one transaction is running, so we need not track it.
        transactionId: 0,
        meterValue: [{
          timestamp: new Date().toISOString(),
          sampledValue: [
            {
              value: powerW.toString(),
              measurand: "Power.Active.Import",
              unit: "W",
            },
            // The app reads amps from this measurand and no other.
            { value: amps.toString(), measurand: "Current.Import", unit: "A" },
            { value: volts.toString(), measurand: "Voltage", unit: "V" },
            {
              value: energyWh().toFixed(2),
              measurand: "Energy.Active.Import.Register",
              unit: "Wh",
            },
          ],
        }],
      },
    }),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`admin /execute failed: ${res.status}`);
};

console.log(
  `driving ${amps}A x ${volts}V = ${powerW}W every ${intervalSec}s -> ${adminUrl}`,
);
await send();
setInterval(() => {
  send().catch((error) => console.error(`send failed: ${error.message}`));
}, intervalSec * 1000);
