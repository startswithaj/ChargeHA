#!/bin/bash
set -e

echo "[entrypoint] Starting ChargeHA server..."

# --allow-ffi / --unstable-ffi: @db/sqlite uses FFI for native SQLite
# --allow-run: Tesla HTTP proxy process, Cloudflare tunnel, Fronius LAN discovery
# --allow-sys=networkInterfaces: Fronius inverter LAN discovery
# --unsafely-ignore-certificate-errors=localhost: Tesla HTTP proxy uses a self-signed
#   TLS cert on localhost:4443. Without this flag, Deno rejects the cert and ALL
#   vehicle commands fail. Do NOT remove this flag.
exec deno run \
  --allow-net \
  --allow-read \
  --allow-write \
  --allow-env \
  --allow-ffi \
  --allow-run \
  --allow-sys=networkInterfaces \
  --unstable-ffi \
  --unsafely-ignore-certificate-errors=localhost \
  packages/server/src/main.ts
