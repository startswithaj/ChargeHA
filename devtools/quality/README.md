# quality

Code quality checks that supplement Deno's built-in linter and formatter.

## Files

- **check-unused-files.sh** — finds source files that are not imported by any
  other file in the project. Excludes test files, config files, known entry
  points, and dynamically imported seeds.

## Usage

```sh
deno task check:unused
```

Runs automatically as part of `deno task check:all`.
