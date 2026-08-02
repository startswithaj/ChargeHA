// One suite per run: fresh stack → wait healthy → tests → teardown.
// Usage: deno run -A e2e/run.ts <suite> [extra-compose-file...]
const [suite, ...overrides] = Deno.args;
const files = [
  "-f",
  "docker/docker-compose.e2e.yml",
  ...overrides.flatMap((f) => ["-f", f]),
];

const compose = (...args: string[]) =>
  new Deno.Command("docker", {
    args: ["compose", ...files, ...args],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

const up = await compose("up", "-d", "--build", "--force-recreate", "--wait");
if (!up.success) {
  await compose("logs");
  await compose("down", "-v");
  Deno.exit(1);
}

const test = await new Deno.Command(Deno.execPath(), {
  args: ["test", "--allow-net", "--allow-env", `e2e/${suite}.e2e.test.ts`],
  stdout: "inherit",
  stderr: "inherit",
}).output();

if (!test.success) await compose("logs", "app"); // failure diagnostics
await compose("down", "-v");
Deno.exit(test.success ? 0 : 1);
