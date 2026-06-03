import { describe, expect, it } from "vitest";
import {
  ALL_DEMO_QUERIES,
  GATED_QUERIES,
  HANDLED_QUERIES,
  PENDING_QUERIES,
} from "./demoPaths.ts";
import { queryHandlers } from "./handlers/index.ts";

describe("demoPaths", () => {
  it("HANDLED_QUERIES matches the actual handler map", () => {
    expect(Object.keys(queryHandlers).sort()).toEqual(
      [...HANDLED_QUERIES].sort(),
    );
  });

  it("buckets are disjoint", () => {
    const all = [...HANDLED_QUERIES, ...GATED_QUERIES, ...PENDING_QUERIES];
    expect(new Set(all).size).toBe(all.length);
  });

  it("ALL_DEMO_QUERIES is the union of the three buckets", () => {
    expect(new Set(ALL_DEMO_QUERIES)).toEqual(
      new Set([...HANDLED_QUERIES, ...GATED_QUERIES, ...PENDING_QUERIES]),
    );
  });
});
