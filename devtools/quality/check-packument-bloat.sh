#!/usr/bin/env bash
# Regression guard for denoland/deno#35285: minimumDependencyAge used to force
# caching of full npm packuments (per-version scripts maps), bloating individual
# registry.json files to ~100MB and spiking startup RSS to ~800-900MB. The fix
# slims cached packuments (deno >= 2.9.0). If a future deno regresses this, the
# runtime docker image RAM blows up again. This asserts no packument is oversized.
set -euo pipefail

MAX_MB=20

# `deno info` (no target) prints "DENO_DIR location: <path>"; strip ANSI colours.
DENO_DIR_PATH="$(deno info 2>/dev/null | sed -e 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/DENO_DIR location/{print $2; exit}')"
REG="${DENO_DIR_PATH}/npm/registry.npmjs.org"

if [ ! -d "$REG" ]; then
  echo "packument guard: no npm cache at $REG (run 'deno install' first) — skipping"
  exit 0
fi

# -printf is GNU-only; list paths (portable) then size them with du -h.
oversized="$(find "$REG" -name registry.json -size +${MAX_MB}M 2>/dev/null || true)"

if [ -n "$oversized" ]; then
  echo "packument guard FAILED: registry.json exceeds ${MAX_MB}MB (deno#35285 regressed?):"
  echo "$oversized" | xargs du -h
  exit 1
fi

echo "packument guard: ok (no registry.json > ${MAX_MB}MB)"
