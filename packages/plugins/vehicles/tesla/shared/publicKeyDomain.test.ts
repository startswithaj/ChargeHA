import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { resolvePublicKeyDomain } from "./publicKeyDomain.ts";

describe("resolvePublicKeyDomain", () => {
  it("returns the saved domain in custom mode", () => {
    expect(
      resolvePublicKeyDomain("custom", "https://example.com", null),
    ).toBe("https://example.com");
  });

  it("ignores a running tunnel in custom mode", () => {
    expect(
      resolvePublicKeyDomain(
        "custom",
        "https://example.com",
        "https://abc.trycloudflare.com",
      ),
    ).toBe("https://example.com");
  });

  it("returns the live tunnel URL in tunnel mode", () => {
    expect(
      resolvePublicKeyDomain("tunnel", "", "https://abc.trycloudflare.com"),
    ).toBe("https://abc.trycloudflare.com");
  });

  it("returns null in tunnel mode when the tunnel is down", () => {
    expect(resolvePublicKeyDomain("tunnel", "", null)).toBeNull();
  });

  it("returns null when unset and no domain is saved", () => {
    expect(resolvePublicKeyDomain("", "", null)).toBeNull();
    expect(resolvePublicKeyDomain("", null, null)).toBeNull();
  });

  it("falls back to a saved domain when mode is unset (pre-migration data)", () => {
    expect(resolvePublicKeyDomain("", "https://example.com", null)).toBe(
      "https://example.com",
    );
  });
});
