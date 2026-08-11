# Realtime events

All live updates reach the browser over **one** SSE connection. The server emits
tagged events; the client routes them by `type`.

## Why one connection

tRPC's `httpSubscriptionLink` opens one EventSource per `useSubscription()`
call, and each one holds a long-lived HTTP connection.

Browsers cap HTTP/1.1 at **6 concurrent connections per origin** (Chromium,
Firefox). That cap is the whole constraint:

- React StrictMode double-mounts components in development. Three subscriptions
  × two mounts = 6 connections — the entire pool.
- With the pool exhausted, a page refresh **hangs**: the new document request
  has no connection slot to use.
- Production has no StrictMode, but three subscriptions still leave only three
  slots for everything else — API calls, static assets — and any new
  subscription pushes past the limit.

One multiplexed connection removes the cap from the picture entirely.

## Why not HTTP/2

HTTP/2 would also solve it (100+ multiplexed streams per connection), but
`Deno.serve` only supports HTTP/2 over TLS, and the app runs on plain HTTP
behind a reverse proxy.

## Adding an event

Add a variant to the `SSEEvent` union in `packages/shared/types.ts`. The union
is the contract: the server emits `{ type, data }`, the client narrows on
`type`. Do not add a second subscription.
