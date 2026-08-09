// One suite per run: fresh stack → wait healthy → tests → teardown.
// Usage: deno run -A e2e/run.ts <suite> [extra-compose-file...]
const [suite, ...overrides] = Deno.args;
const files = [
  "-f",
  "docker/docker-compose.e2e.yml",
  ...overrides.flatMap((f) => ["-f", f]),
  // ocpp suites additionally start the profiled vcp charger simulator.
  ...(suite.startsWith("ocpp") ? ["--profile", "ocpp"] : []),
];

const compose = (...args: string[]) =>
  new Deno.Command("docker", {
    args: ["compose", ...files, ...args],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

const up = await compose("up", "-d", "--build", "--wait");
if (!up.success) {
  await compose("logs");
  await compose("down", "-v");
  Deno.exit(1);
}

const test = await new Deno.Command(Deno.execPath(), {
  // --allow-run=docker: the OCPP suite restarts the app container to prove a
  // charger reconnects afterwards. Scoped to docker rather than blanket.
  args: [
    "test",
    "--allow-net",
    "--allow-env",
    "--allow-run=docker",
    `e2e/${suite}.e2e.test.ts`,
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();

if (!test.success) await compose("logs", "app"); // failure diagnostics
await compose("down", "-v");
Deno.exit(test.success ? 0 : 1);
