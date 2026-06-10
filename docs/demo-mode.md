# Demo Mode

A static, no-backend build of the client that runs on GitHub Pages so people can
explore the interface without a server, database, or real Tesla/Fronius account.
Same React app, same routes, same components — only the data source changes.

## The interception point: a terminating tRPC link

The client only ever talks to the server through tRPC. The React hooks
(`trpc.x.y.useQuery()`) don't call a `trpc` object directly — they hand the
operation to React Query → `trpcClient` → its **links**, which is where HTTP
actually happens. So the link is the right place to intercept.

In a demo build the HTTP links are replaced by a single terminating `demoLink`
that resolves every operation from build-time fixtures + in-memory state.

```
┌──────────────────────────┐
│ React components / hooks  │   ← unchanged
├──────────────────────────┤
│ React Query + trpcClient  │   ← unchanged
├──────────────────────────┤
│ tRPC links                │   ← demoLink replaces http links
├──────────────────────────┤
│ HTTP / tRPC server        │   ← absent in demo build
└──────────────────────────┘
```

The swap is gated on the `VITE_DEMO_MODE` build flag. No sqlite, server, or
aggregation code is shipped to the browser.

`demoLink` resolves the three operation kinds:

- **Queries** → looked up from recorded fixtures or in-memory `demoState`.
- **Mutations** → mutate `demoState`, persist, return a success-shaped result.
- **Subscriptions** (events only) → an observable driven by the demo tick.

## Data: recorded real responses

Fixtures are generated at **build time**, not hand-authored:

1. An in-memory database is spun up (same one integration tests use).
2. ~90 days of history are simulated through the **simulated vehicle** and
   **simulated energy** plugins.
3. The real app router is built and every query procedure is called across its
   input space (each day/month/year, logs, config, plugins, …).
4. Each `(path, input) → response` is serialized to static JSON.

This reuses 100% of the real aggregation logic and ships only its outputs.
History is generated at 15-minute buckets — the finest granularity the UI ever
displays. One fine-grained "live day" is shipped separately to drive the ticking
dashboard.

## State, persistence & the tick

- **`demoState`** is the single source of truth for the session.
- User-mutable slices (vehicles, schedules, config) hydrate from
  `sessionStorage` on boot and persist on every mutation — demo edits survive a
  reload but reset when the tab closes.
- The simulation cursor and recorded fixtures are **not** persisted.
- A **tick** advances a cursor through the live day on an interval; the realtime
  energy query reads the cursor and the events subscription re-emits on each
  tick, so the dashboard animates.

## Gating (wizard + settings)

Demo lands on the first-run wizard with restricted options:

| Surface       | Allowed in demo          | Disabled in demo        |
| ------------- | ------------------------ | ----------------------- |
| Auth mode     | None, Username/Password  | OIDC                    |
| Vehicle type  | Simulated (auto-created) | Tesla                   |
| Inverter type | Simulated energy         | Fronius (local + cloud) |

Two mechanisms keep this clean:

- **Core features** are gated via a `Feature` enum + `isFeatureEnabled` (e.g.
  `Feature.OidcAuth`).
- **Plugin availability** is gated by a `demoAvailable?` flag declared on plugin
  option metadata (inside `plugins/`), so core code disables generically with
  `disabled={isDemoMode && !option.demoAvailable}` — no plugin IDs leak into
  core, respecting the `no-plugin-refs` lint rule.

After local auth is chosen the demo stays authenticated through the wizard (no
real login). Home location is prefilled to Sydney. `notification.test` returns a
fake success — nothing is sent.

## Build & deploy

```sh
VITE_DEMO_MODE=1 deno task build     # → packages/client/dist/
```

A GitHub Actions workflow builds with `VITE_DEMO_MODE=1` and publishes `dist/`
to GitHub Pages (the Vite `base` path is set for the Pages subpath).

## Limitations

- **Auth flows are skipped** — the session resolves as authenticated.
- **Time drifts** — real `new Date()` in components diverges from the cursor;
  accepted for non-critical UI.
- **Only user-mutable state persists** — cursor and fixtures reset on reload.
- **Fixture paths must match the router exactly** — the generator records by
  exact tRPC path, so a router restructure requires regenerating fixtures.
