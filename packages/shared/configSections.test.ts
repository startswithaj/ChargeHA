import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { z } from "zod";
import {
  defineSection,
  serializeSection,
  serializeSectionPatch,
} from "./configSections.ts";

describe("serializeSectionPatch", () => {
  const section = defineSection({
    host: { key: "host", schema: z.string(), default: "" },
    count: { key: "count", schema: z.number(), default: 0 },
    enabled: { key: "enabled", schema: z.boolean(), default: false },
    label: { key: "label", schema: z.string().nullable(), default: null },
  });

  it("maps a cleared string field to null — not empty string", () => {
    const patch = serializeSectionPatch(section, { host: "" });
    expect(patch.host).toBeNull();
  });

  it("maps null to null (an explicit unset)", () => {
    const patch = serializeSectionPatch(section, { label: null });
    expect(patch.label).toBeNull();
  });

  it("maps undefined to null (field absent from a partial patch is skipped instead)", () => {
    // Only keys present in `values` are included at all — this covers a key
    // explicitly set to undefined.
    const patch = serializeSectionPatch(section, { label: undefined });
    expect(patch.label).toBeNull();
  });

  it("keeps a real 0, serialized rather than treated as absent", () => {
    const patch = serializeSectionPatch(section, { count: 0 });
    expect(patch.count).toBe("0");
  });

  it("keeps a real false, serialized rather than treated as absent", () => {
    const patch = serializeSectionPatch(section, { enabled: false });
    expect(patch.enabled).toBe("false");
  });

  it("keeps a non-empty string as-is", () => {
    const patch = serializeSectionPatch(section, { host: "10.0.0.1" });
    expect(patch.host).toBe("10.0.0.1");
  });

  it("only includes keys present in the input", () => {
    const patch = serializeSectionPatch(section, { host: "x" });
    expect(Object.keys(patch)).toEqual(["host"]);
  });

  it("does not change serializeSection's behaviour (empty string stays empty string)", () => {
    const result = serializeSection(section, { host: "" });
    expect(result.host).toBe("");
  });
});
