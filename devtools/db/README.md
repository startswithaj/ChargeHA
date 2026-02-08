# db

Database management CLI and snapshot utilities for local development.

## Files

- **db-cli.ts** — CLI for resetting, seeding, and managing the SQLite database.
- **snapshots.ts** — Save, restore, list, and delete named database snapshots
  (stored alongside the database in `data/snapshots/`).

## Usage

```sh
# Reset and recreate tables (requires --yes)
deno task db:cli reset --yes

# Seed with a default profile
deno task db:cli seed

# Save / restore / list / delete snapshots
deno task db:cli save my-snapshot
deno task db:cli restore my-snapshot
deno task db:cli list
deno task db:cli delete my-snapshot
```

Set `DB_PATH` to override the default database location (`./data/chargeha.db`).
All destructive commands are blocked in production environments.
