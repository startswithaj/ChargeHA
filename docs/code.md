# ChargeHA — Codebase Reference

## Overview

**ChargeHA** is a solar-aware EV charging controller.

## Tech Stack

| Layer          | Technology                                                   |
| -------------- | ------------------------------------------------------------ |
| Runtime        | Deno                                                         |
| Server         | Hono                                                         |
| API            | tRPC v11, Zod (validation), SSE subscriptions (realtime)     |
| Database       | SQLite via `@db/sqlite` (JSR), Drizzle ORM, drizzle-kit      |
| Auth           | Argon2 (`@ts-rex/argon2`), oauth4webapi (OIDC)               |
| Client         | React 18, Vite 6, TypeScript                                 |
| UI             | Radix UI Themes, Lucide React (icons), CSS Modules           |
| Charts         | Recharts                                                     |
| Data fetching  | tRPC React Query (`@trpc/react-query`), TanStack React Query |
| Client testing | Vitest, React Testing Library, jsdom                         |
| Server testing | Deno built-in test runner, `@std/expect`, `@std/testing`     |
| Build          | Vite (client), Deno (server)                                 |
| Misc           | qrcode.react (QR codes)                                      |

Deno workspace with four members: `packages/shared/`, `packages/server/`,
`packages/client/`, `packages/plugins/`.

### Dev server flag

The client `dev` / `dev:demo` tasks pass `--unstable-no-legacy-abort`. Without
it, Vite's dev server throws uncaught `AbortError`s under Deno's legacy abort
behavior when the browser cancels in-flight requests (HMR, page reload, proxy) —
see denoland/deno#28632. Remove once this behavior becomes Deno's default.

## Project Structure

```
packages/shared/
  types.ts                   — All shared types (EnergyData, VehicleChargeState,
                               StatsResponse, Schedule, TariffBreakdownEntry, etc.)
  schemas.ts                 — Zod schemas shared between server and client
  configSections.ts          — Config section definitions + key registry
  engine/                    — Pure charging logic (ControllerEngine, SolarAllocator,
                               DecisionChecks, Schedules)
  simulation/                — Simulation helpers (solar curve generation, run harness)
  test-factories.ts          — Shared test factories (buildVehicleChargeState, etc.)
packages/plugins/
  componentRegistry.ts          — Client-side plugin component registry
  createPluginConfigProcedures.ts — Factory for plugin tRPC config procedures
  PluginDbLogger.ts             — DB-backed logger exposed to plugins
  registerPlugins.ts            — Wires plugins into the server registries on boot
  types.ts                      — Plugin interfaces (EnergyPlugin, VehiclePlugin, etc.)
  energy/
    fronius-local/              — Fronius inverter (local HTTP) plugin
    fronius-cloud/              — Fronius Cloud API plugin
  vehicles/
    tesla/                      — Tesla Fleet API plugin (adapter, proxy, tokens, router)
    simulated/                  — Simulated vehicle for dev/demo
packages/server/src/
  main.ts                    — Entry point, initializes all services + plugins
  healthcheck.ts             — Standalone health probe (used by Docker)
  bootstrap/                 — App creation, service wiring, lifecycle, and the
                               EnergyPluginRegistry / VehiclePluginRegistry that
                               core code uses to interact with plugins
  db/
    AppDatabase.ts           — AppDatabase class with query methods
    Schema.ts                — Drizzle ORM table definitions
    SqliteCompat.ts          — SQLite compatibility layer (@db/sqlite)
    Serialization.ts         — DB serialization helpers
    MigrationRunner.ts       — Runs Drizzle migrations on startup
    repositories/            — Query repositories (Config, Energy, Stats, Vehicle, etc.)
    seeds/                   — Seed data for development
  trpc/
    trpc.ts                  — tRPC init, TrpcContext interface, publicProcedure
    root.ts                  — createAppRouter merging core + plugin routers
    routers/                 — One file per domain (energy, vehicles, stats, etc.)
  routes/
    oidcAuth.ts              — OIDC authentication callback routes
  middleware/
    auth.ts                  — Authentication middleware
    rateLimit.ts             — Rate limiting middleware
  services/                  — One class per domain concern (ChargeController,
                               VehicleManager, ConfigService, etc.)
  lib/                       — Utilities (Logger, Encryption, Geo, Tariffs)
  test-helpers/              — Test factories and helpers for server tests
packages/client/src/
  App.tsx                    — Root component, routing
  trpc.ts                    — tRPC React client (createTRPCReact)
  components/pages/
    Dashboard/               — Real-time energy overview, vehicle list
    Stats/                   — Historical energy/charging charts
    Schedules/               — Charge schedule management
    Settings/                — Auth, inverter, tariff, notification, vehicle config
    Logs/                    — Controller/energy/vehicle logs
  components/Wizard/         — First-run setup wizard (see Wizard Steps below)
  hooks/                     — React hooks (useVehicles, useStats, etc.)
  lib/                       — Client utilities (stores, tRPC setup, solar allocation)
  utils/                     — Formatting helpers
docker/                      — Dockerfile and entrypoint
drizzle/                     — Migration files and Drizzle config
devtools/
  db/                        — Database reset/seed/snapshot CLI (see devtools/db/README.md)
  lint-plugins/              — Custom Deno lint plugins (see devtools/lint-plugins/README.md)
  oidc/                      — Local OIDC provider for testing SSO (see devtools/oidc/README.md)
  quality/                   — Unused file check (see devtools/quality/README.md)
  sim/                       — Charge simulators + analysis tools (see devtools/sim/README.md)
docs/                        — Architecture docs, setup guides, design notes
```

## Plugin System

Adapters for vehicles and energy sources live in `packages/plugins/` as
self-contained plugins. Each plugin provides:

- **Server:** adapter implementation, config definition, optional tRPC router
- **Client:** wizard step definitions (registered via `componentRegistry.ts`)

Plugin registries (`VehiclePluginRegistry`, `EnergyPluginRegistry`) handle
discovery, initialization, lifecycle, and config key registration. Core code
should not reference specific plugin IDs — interact through registry interfaces.

Plugin routers are merged into the app router dynamically via
`createAppRouter(pluginRouters)` in `trpc/root.ts`.

## Wizard Steps

The first-run setup wizard (`components/Wizard/`) uses string-based step IDs
(not numeric indices) so steps can be composed dynamically from core steps and
plugin-contributed steps. Progress is persisted to the DB via tRPC and the
wizard can resume across sessions.

Step composition order:

1. **Core before:** Welcome → Authentication → Timezone → Vehicle Type
2. **Vehicle plugin steps** (e.g. Tesla: key gen, hosting, credentials, partner
   registration, authorization, vehicle selection, virtual key pairing)
3. **Core middle:** Inverter Type
4. **Energy plugin steps** (e.g. Fronius: inverter setup/discovery)
5. **Core after:** Home Location → Done

A demo shortcut creates a simulated vehicle and skips plugin-specific config.

## Key Patterns

- **Data flow:** Adapter → Poller → EventEmitter → Listeners / tRPC SSE → React
  Query → UI
- **Inter-service communication uses `TypedEventEmitter`** — pollers emit typed
  events and consumers subscribe via the shared event bus. Prefer the event bus
  over callbacks or direct method calls for cross-service data flow.
- **New types** go in `packages/shared/types.ts`
- **Zod schemas** go in `packages/shared/schemas.ts`
- **CSS Modules** for component styling (`*.module.css`)
- **Dependency injection** via `createApp(AppDependencies)` in `bootstrap/`
- **Tariffs & schedules are wall-clock times, not UTC** — stored as `HH:MM`
  strings in the user's configured timezone. DB timestamps are UTC. Avoid
  `Date.getHours()` / `Date.getDay()` for matching — convert to the configured
  timezone first.
- **SQLite compatibility layer** — Deno uses `@db/sqlite` (native FFI) but
  Drizzle ORM expects the `better-sqlite3` API. `SqliteCompat.ts` bridges the
  gap by wrapping `@db/sqlite` statements to provide `.raw()`, `.run()` return
  shapes, and `transaction()` with deferred/immediate/exclusive modes. The
  interface is defined in `packages/shared/database-driver.ts`
  (`DatabaseDriver`, `DatabaseStatement`) so alternative backends (e.g. WASM for
  the browser) can implement the same contract.
- **Prefer the Drizzle query builder over raw SQL** — use `.select()`,
  `.from()`, `.where()`, `.orderBy()` with typed column references and operators
  like `eq()`, `gte()`, `lte()`, `inArray()`, `max()`, etc. Reserve `sql`
  template literals for SQLite-specific functions that Drizzle can't express
  (e.g. `strftime()`, `datetime('now', ...)`, `SUM(CASE WHEN ...)`
  aggregations). Don't wrap simple column comparisons in `sql`datetime(col) >=
  datetime(val)`` when `gte(col, val)` works — timestamps are stored in ISO-8601
  format and compare lexicographically.

## Conventions

### Server

- Services are classes with constructor-injected dependencies. New services are
  instantiated in `main.ts` and available on `TrpcContext`.
- When a service covers multiple concerns, split into a facade + sub-services
  (e.g. `AuthService` delegates to `AuthLocalService` and `AuthOIDCService`).
- tRPC routers are thin — validate input, call a service, return the result.
- Core code should not reference specific plugin IDs. Use plugin registry
  interfaces. Plugins access the DB through `PluginDependencies`, not
  `AppDatabase` directly.

### Server: tRPC

- Most API endpoints are tRPC procedures in `packages/server/src/trpc/routers/`.
- Hono REST routes (`packages/server/src/routes/`) are used where raw HTTP
  access is needed (e.g. OIDC callbacks).

### Client

- Data fetching uses tRPC hooks: `trpc.someRouter.someQuery.useQuery()`.
- Mutations use `trpc.someRouter.someMutation.useMutation()`.

## Testing

Code changes should have test coverage. Server tests use Deno's built-in test
runner (`@std/testing/bdd`, `@std/expect`); client tests use Vitest with React
Testing Library.

### Server: Unit Tests

Test individual services by injecting dependencies. Use
`throwingMock<T>(label, overrides)` from `test-helpers/throwingMock.ts` — a
Proxy-based stub where unstubbed method calls throw
`"{label}.{method} was called but not stubbed"` instead of failing with
`undefined is not a function`. No `as unknown as T` double-casts.

```typescript
const energyManager = throwingMock<EnergyAdapterManager>(
  "EnergyAdapterManager",
  {
    reconfigureAndRestart: () => {
      reconfigureCalled = true;
    },
  },
);

const service = new ConfigService(db, energyManager, null, testLogger);
```

Use this for any interface stub — DB, registry, manager, adapter. Only the
methods the test actually exercises need to be supplied; everything else fails
loudly.

Use `testable()` from `test-helpers/Testable.ts` to access private methods in
tests without `as any` casts. Use `FakeTime` from `@std/testing/time` for
time-dependent tests.

### Server: Integration Tests

Use real class instances with an in-memory database
(`new AppDatabase(":memory:")`) to test full workflows across multiple services:

```typescript
db = new AppDatabase(":memory:");
await db.init();
const authService = new AuthService(
  db,
  null,
  logger,
  oidcService,
  configService,
  rateLimiter,
);
```

tRPC endpoints can be integration-tested by creating a real app and sending
requests:

```typescript
const app = createApp(makeDeps({ ... }));
const res = await app.fetch(new Request("http://localhost/trpc/health.encryption?input=%7B%7D&batch=1"));
```

### Client Tests

Use `renderWithProviders()` from `test-utils.tsx` to wrap components with
QueryClient, Theme, and ToastProvider.

Mock tRPC hooks via `vi.mock("../../trpc.ts")` — return stub `useQuery` /
`useMutation` results. Capture callbacks (like `onSuccess`) for later invocation
in tests:

```typescript
vi.mock("../../trpc.ts", () => ({
  trpc: {
    auth: {
      login: {
        useMutation: vi.fn((opts) => {
          capturedOnSuccess = opts?.onSuccess;
          return { mutate: mockMutate, isPending: false, error: null };
        }),
      },
    },
  },
}));
```

### Test Fixtures

Use the factory-with-overrides pattern. Shared factories live in
`packages/shared/test-factories.ts`, server-specific ones in
`packages/server/src/test-helpers/factories.ts`:

```typescript
const state = buildVehicleChargeState({ batteryLevel: 95, isCharging: true });
const energy = buildEnergyData({ solarProductionW: 3000 });
```

### Database in Tests

Use `:memory:` or a uniquely-named temporary file — don't use
`./data/chargeha.db` or let `DB_PATH` fall through to the default. Clean up any
database files created during tests.

## Quality Commands

Run before finishing any task:

```
deno task check:all — All checks + tests (fmt, lint, types, plugin-refs, unused, tests)
```

Other commands:

```
deno task test           — Run all tests (server + plugins + client)
deno task test:server    — Server + plugin unit tests (Deno)
deno task test:client    — Client unit tests (vitest, includes plugin UI)
deno check               — Type check all code
deno task fmt:check      — Check formatting
deno fmt                 — Auto-fix formatting
deno task lint           — Lint all code (includes custom plugins)
deno task check:unused   — No orphaned/unused source files
deno task build          — Build production client
```

### Devtools

See individual READMEs in each `devtools/` subdirectory for detailed usage:

- [Database CLI](../devtools/db/README.md) — reset, seed, and snapshot
  management
- [Lint Plugins](../devtools/lint-plugins/README.md) — custom Deno lint rules
- [OIDC Provider](../devtools/oidc/README.md) — local identity provider for
  testing SSO
- [Quality Checks](../devtools/quality/README.md) — unused file detection
- [Simulators](../devtools/sim/README.md) — solar and charge simulations

## Lint

Lint config lives in `deno.json` (`lint.rules`). Project-specific rules —
`no-imperative-loops`, `no-let`, `no-foreach-mutation`, `no-plugin-refs` — are
documented in
[`devtools/lint-plugins/README.md`](../devtools/lint-plugins/README.md).

The Deno built-in `no-non-null-assertion` rule is opted in (on top of the
`recommended` tag). When you need to narrow `T | null | undefined` in tests, use
`assertExists(x)` from `@std/assert` instead of `x!`.
