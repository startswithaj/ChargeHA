# lint-plugins

Custom Deno lint plugins enforcing project code style and safety rules.

Registered in the root `deno.json` under `lint.plugins` and run automatically
via `deno task lint` and `deno task check:all`.

## Plugins

| Plugin                     | What it enforces                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| **expression-complexity**  | Bans nested ternaries, multi-line ternaries (>3 lines), and multi-line boolean expressions (>2 lines). |
| **function-length**        | Max function body length — 110 lines for production code in `services/`, 200 for test files.           |
| **no-foreach-mutation**    | No mutating outer-scope collections inside `.forEach()` callbacks. Use `.reduce()` instead.            |
| **no-imperative-loops**    | Bans `for`, `for...of`, `for...in`, `while`, `do...while`. Use `.map()` / `.filter()` / `.reduce()`.   |
| **no-let**                 | Bans `let` declarations. Use `const` with early returns, ternaries, or reduce.                         |
| **no-param-mutation**      | No mutating objects passed as function parameters. Return new values instead.                          |
| **no-plugin-refs**         | No hardcoded plugin IDs (`tesla`, `fronius`, `simulated`) outside `plugins/`.                          |
| **no-select-side-effects** | No store mutations or side effects inside React Query `select` callbacks.                              |
| **no-swallowed-catch**     | Catch blocks must do something with the error (log, rethrow, or assign).                               |

## Testing

Each plugin with non-trivial logic has a co-located `*.test.ts` file. Tests run
as part of `deno task test:server`.
