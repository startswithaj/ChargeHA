import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { checkTeslaProxyHealth } from "./index.ts";

describe("checkTeslaProxyHealth", () => {
  it("returns ok without probing the proxy when Tesla is not set up", async () => {
    let configChecked = false;
    const result = await checkTeslaProxyHealth({
      getSecret: () => Promise.resolve(null),
      getConfig: () => {
        configChecked = true;
        return Promise.resolve(null);
      },
    });

    expect(result).toEqual({ status: "ok" });
    // Regression guard: must short-circuit before touching the proxy at all.
    expect(configChecked).toBe(false);
  });

  it("reports an error when set up but the proxy is unreachable", async () => {
    const result = await checkTeslaProxyHealth({
      getSecret: () => Promise.resolve("PRIVATE_KEY_PEM"),
      // Nothing listens on this port, so the connect attempt fails.
      getConfig: () => Promise.resolve("https://localhost:1"),
    });

    expect(result).toEqual({
      status: "error",
      message: "Tesla proxy not reachable",
    });
  });
});
