#!/usr/bin/env bash
# Finds source files that are not imported by any other file in the project.
# Excludes test files, config files, and known entry points.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Known entry points (run directly, not imported)
ENTRY_POINTS="
packages/server/src/main.ts
packages/client/src/main.tsx
devtools/db/db-cli.ts
packages/server/src/healthcheck.ts
"

# Extract all import/export-from specifiers into a temp file
IMPORT_PATHS=$(mktemp)
trap '/bin/rm -f "$IMPORT_PATHS"' EXIT

# Capture: import ... from "path", export ... from "path", import("path")
grep -rhE "(from|import\()\s*[\"']" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage \
  . 2>/dev/null \
  | sed -E "s/.*from\s*[\"']([^\"']+)[\"'].*/\1/; s/.*import\(\s*[\"']([^\"']+)[\"'].*/\1/" \
  | sort -u > "$IMPORT_PATHS"

count=0
unused=""

while IFS= read -r file; do
  rel="${file#./}"

  # Skip non-source files
  [[ "$rel" == *.test.ts ]] && continue
  [[ "$rel" == *.test.tsx ]] && continue
  [[ "$rel" == */deno.json ]] && continue
  [[ "$rel" == deno.json ]] && continue

  # Skip entry points
  if echo "$ENTRY_POINTS" | grep -qx "$rel"; then
    continue
  fi

  # Skip config/script files that are run directly
  [[ "$rel" == devtools/* ]] && continue
  [[ "$rel" == *.config.ts ]] && continue
  [[ "$rel" == drizzle.config.ts ]] && continue

  # Get the filename and name without extension
  filename=$(basename "$file")
  name_no_ext="${filename%.*}"

  # Skip test setup and test factory files (referenced via vitest.config.ts setupFiles
  # or workspace package aliases like @chargeha/shared/test-factories, not bare imports)
  [[ "$filename" == "test-setup.ts" ]] && continue
  [[ "$filename" == "test-factories.ts" ]] && continue
  [[ "$rel" == packages/server/src/test-helpers/* ]] && continue

  # Check if this file appears in any import path
  # Strategy: search for the filename (with ext) or the name (without ext) in import paths
  if grep -q "$filename" "$IMPORT_PATHS" 2>/dev/null; then
    continue
  fi

  # Also check for directory index pattern (import from "./dir" resolving to ./dir/index.ts or ./dir/mod.ts)
  if [[ "$filename" == "index.ts" || "$filename" == "index.tsx" || "$filename" == "mod.ts" ]]; then
    dir_name=$(basename "$(dirname "$file")")
    if grep -q "/$dir_name" "$IMPORT_PATHS" 2>/dev/null; then
      continue
    fi
  fi

  # Also try the path without extension (some imports omit .ts)
  file_no_ext="${rel%.*}"
  if grep -q "$file_no_ext" "$IMPORT_PATHS" 2>/dev/null; then
    continue
  fi

  # Workspace alias imports (e.g. @chargeha/shared/schemas) don't contain the
  # packages/ prefix, so also try the path with that prefix stripped.
  stripped="${file_no_ext#packages/}"
  if [[ "$stripped" != "$file_no_ext" ]] && grep -q "$stripped" "$IMPORT_PATHS" 2>/dev/null; then
    continue
  fi

  # Check if file is referenced in any deno.json (root or package-level,
  # e.g. package exports that map workspace aliases to concrete files).
  if grep -rq "$rel" --include="deno.json" . 2>/dev/null; then
    continue
  fi

  # Package-level deno.json exports use a path relative to the package root
  # (e.g. "./src/bootstrap/PluginDependencies.ts"), not the repo root, so
  # also try the package-relative form.
  pkg_relative="./${rel#packages/*/}"
  if [[ "$pkg_relative" != "./$rel" ]] && grep -rq "$pkg_relative" --include="deno.json" . 2>/dev/null; then
    continue
  fi

  # Check if it's a dynamically imported seed file
  [[ "$rel" == packages/server/src/db/seeds/*.ts ]] && continue

  # wasm-database is exported from shared/deno.json for the browser demo (prd-browser-demo.md)
  # but not currently imported by any source file
  [[ "$rel" == packages/shared/wasm-database.ts ]] && continue

  unused+="- \`$rel\`
"
  count=$((count + 1))
done < <(find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/dist/*" \
  -not -path "*/coverage/*" \
  | sort)

if [[ $count -gt 0 ]]; then
  echo "Potentially unused files:"
  echo ""
  echo "$unused"
  echo "Found $count file(s) with no detected imports."
  echo "Verify before deleting — some may be dynamically imported."
  exit 1
fi

echo "No unused files detected."
