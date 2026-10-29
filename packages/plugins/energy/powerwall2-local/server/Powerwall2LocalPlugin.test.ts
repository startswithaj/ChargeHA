import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { pluginHarness } from "./test-helpers/pluginHarness.ts";
import { Powerwall2LocalAdapter } from "./Powerwall2LocalAdapter.ts";

import {
  createCallerFactory,
  type TrpcContext,
} from "../../../../server/src/trpc/trpc.ts";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";
import { createPowerwall2LocalRouter } from "./router.ts";

describe("Powerwall plugin and config router", () => {
  async function setup() {
    const base = await pluginHarness();
    const caller = createCallerFactory(
      createPowerwall2LocalRouter(base.deps, base.plugin),
    )(
      throwingMock<TrpcContext>("TrpcContext"),
    );
    return { ...base, caller };
  }
  let ctx: Awaited<ReturnType<typeof setup>>;
  const config = {
    host: "192.0.2.10",
    email: "owner@example.com",
    password: "test-only-password",
    maxStalenessSeconds: "60",
    pollIntervalSeconds: "30",
  };
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.plugin.shutdown();
    ctx.db.close();
  });

  it("returns server defaults for a fresh plugin without stored config", async () => {
    expect(
      await ctx.db.getPluginConfig("powerwall2_local.max_staleness_seconds"),
    ).toBeNull();
    expect(
      await ctx.db.getPluginConfig("powerwall2_local.poll_interval_seconds"),
    ).toBeNull();
    expect(await ctx.caller.getConfig()).toEqual({
      host: "",
      email: "",
      password: "",
      maxStalenessSeconds: "60",
      pollIntervalSeconds: "30",
    });
  });

  it("round-trips the config with an encrypted, namespaced password", async () => {
    await ctx.caller.setConfig(config);

    expect(await ctx.caller.getConfig()).toEqual(config);

    const stored = await ctx.db.getPluginConfig("powerwall2_local.password");

    expect(stored).not.toBe(config.password);
    expect(stored).not.toBeNull();
    expect(await ctx.deps.getSecret("password")).toBe(config.password);
    expect(ctx.plugin.secretKeys).toEqual(["password"]);
    expect(await ctx.plugin.createAdapter()).toBeInstanceOf(
      Powerwall2LocalAdapter,
    );
  });

  it("partial saves preserve other settings and the encrypted password", async () => {
    await ctx.caller.setConfig(config);
    await ctx.caller.setConfig({ maxStalenessSeconds: "30" });

    expect(await ctx.caller.getConfig()).toEqual({
      ...config,
      maxStalenessSeconds: "30",
    });
  });

  it("rejects invalid freshness and host values before writing config", async () => {
    await ctx.caller.setConfig(config);

    await expect(ctx.caller.setConfig({ maxStalenessSeconds: "0" })).rejects
      .toThrow();
    await expect(
      ctx.caller.setConfig({ host: "https://user:pass@example.com/path" }),
    ).rejects.toThrow();

    expect(await ctx.caller.getConfig()).toEqual(config);
  });

  it("validates connection input without contacting a host", async () => {
    await expect(ctx.caller.testConnection({ ...config, password: "" })).rejects
      .toThrow();
    await expect(
      ctx.caller.testConnection({ ...config, maxStalenessSeconds: "301" }),
    ).rejects.toThrow();
  });

  it("requires configured host and creates its router without side effects", async () => {
    await expect(ctx.plugin.createAdapter()).rejects.toThrow(
      "host is not configured",
    );
    expect(ctx.plugin.getRouter()).toBeDefined();
    expect(ctx.plugin.getHealthChecks()).toEqual([]);
  });
});
