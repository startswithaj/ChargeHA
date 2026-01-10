import { expect } from "@std/expect";
import plugin from "./no-param-mutation.ts";
import { runPlugin } from "./test-helpers/runPlugin.ts";

Deno.test("no-param-mutation", async (t) => {
  const filename = "packages/server/src/services/example.ts";
  const lint = (source: string) => runPlugin(plugin, source, filename);

  // [name, source, msgIncludes] — every flag-case expects exactly one diagnostic.
  const flagCases: Array<[name: string, source: string, msgIncludes: string]> =
    [
      [
        "flags property assignment on parameter",
        `function update(config) { config.enabled = true; }`,
        "config",
      ],
      [
        "flags nested property assignment on parameter",
        `function update(config) { config.nested.value = 42; }`,
        "config",
      ],
      [
        "flags compound assignment on parameter property",
        `function inc(state) { state.count += 1; }`,
        "state",
      ],
      [
        "flags delete on parameter property",
        `function clean(obj) { delete obj.temp; }`,
        "obj",
      ],
      [
        "flags update expression on parameter property",
        `function inc(state) { state.count++; }`,
        "state",
      ],
      [
        "flags prefix update on parameter property",
        `function dec(state) { --state.count; }`,
        "state",
      ],
      [
        "flags push on parameter array",
        `function addItem(items) { items.push("new"); }`,
        "push()",
      ],
      [
        "flags splice on parameter array",
        `function removeFirst(items) { items.splice(0, 1); }`,
        "splice()",
      ],
      [
        "flags sort on parameter array",
        `function order(items) { items.sort(); }`,
        "sort()",
      ],
      [
        "flags reverse on parameter array",
        `function flip(items) { items.reverse(); }`,
        "reverse()",
      ],
      [
        "flags Map.set on parameter",
        `function populate(map) { map.set("key", "value"); }`,
        "set()",
      ],
      [
        "flags Set.add on parameter",
        `function addTag(tags) { tags.add("new"); }`,
        "add()",
      ],
      [
        "flags Object.assign with parameter as target",
        `function merge(config) { Object.assign(config, { extra: true }); }`,
        "Object.assign()",
      ],
      [
        "flags Object.defineProperty on parameter",
        `function define(obj) { Object.defineProperty(obj, "x", { value: 1 }); }`,
        "Object.defineProperty()",
      ],
      [
        "flags mutation in arrow function parameter",
        `const update = (config) => { config.enabled = true; };`,
        "config",
      ],
      [
        "flags mutation on parameter with default value",
        `function update(config = {}) { config.enabled = true; }`,
        "config",
      ],
      [
        "flags mutation on rest parameter",
        `function process(...items) { items.push("extra"); }`,
        "push()",
      ],
      [
        "flags mutation in class method parameter",
        `class Svc { update(config) { config.enabled = true; } }`,
        "config",
      ],
      [
        "flags non-accumulator param in reduce callback",
        `const result = items.reduce((acc, item) => { item.seen = true; return acc; }, {});`,
        "item",
      ],
    ];

  // [name, source] — every pass-case expects zero diagnostics.
  const passCases: Array<[name: string, source: string]> = [
    [
      "allows mutation of local variables",
      `function build() { const obj = {}; obj.foo = 1; }`,
    ],
    [
      "allows reassignment of parameter itself",
      `function process(value) { value = transform(value); }`,
    ],
    [
      "allows spread copy then mutate",
      `function sorted(items) { return [...items].sort(); }`,
    ],
    [
      "allows non-mutating method calls on parameters",
      `function process(items) { return items.map(x => x + 1); }`,
    ],
    [
      "allows Object.assign with parameter as source",
      `function copy(source) { return Object.assign({}, source); }`,
    ],
    [
      "allows mutation on destructured parameter properties",
      `function process({ count }) { count = count + 1; }`,
    ],
    [
      "allows property access without mutation",
      `function read(config) { return config.enabled; }`,
    ],
    [
      "allows push on local array inside function with params",
      `function collect(source) { const result = []; result.push(source); return result; }`,
    ],
    [
      "allows this mutation",
      `class Svc { update() { this.enabled = true; } }`,
    ],
    [
      "allows reduce accumulator mutation",
      `const grouped = items.reduce((acc, item) => { acc[item.key] = item; return acc; }, {});`,
    ],
    [
      "allows reduce accumulator push",
      `const flat = items.reduce((acc, item) => { acc.push(...item.children); return acc; }, []);`,
    ],
    [
      "allows reduceRight accumulator mutation",
      `const result = items.reduceRight((acc, item) => { acc[item.key] = item; return acc; }, {});`,
    ],
  ];

  for (const [name, source, msgIncludes] of flagCases) {
    await t.step(name, () => {
      const diagnostics = lint(source);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].message).toContain(msgIncludes);
    });
  }

  for (const [name, source] of passCases) {
    await t.step(name, () => {
      const diagnostics = lint(source);
      expect(diagnostics).toHaveLength(0);
    });
  }
});
