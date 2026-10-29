import { PowerwallGatewayClient } from "./PowerwallGatewayClient.ts";
import { FakePowerwallHttp, response } from "./test-helpers/powerwallHttp.ts";
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { LogService } from "../../../../server/src/services/LogService.ts";
import { Powerwall2LocalAdapter } from "./Powerwall2LocalAdapter.ts";
import { stub } from "@std/testing/mock";
import { pluginHarness } from "./test-helpers/pluginHarness.ts";
import {
  aggregates,
  FakePowerwallApi,
  NOW,
} from "./test-helpers/powerwallApi.ts";

describe("Powerwall2LocalPlugin.testConnection", () => {
  const input = {
    host: "192.0.2.10",
    email: "",
    password: "example",
    maxStalenessSeconds: "60",
    pollIntervalSeconds: "30",
  };
  [true, false].forEach((fails) => {
    it(`keeps interactive connection results out of Logs (fails=${fails})`, async () => {
      const ctx = await pluginHarness();
      const api = new FakePowerwallApi(
        fails ? new Error("offline") : aggregates(),
      );
      using mocked = stub(
        ctx.plugin,
        "createAdapter",
        (_input, dbLog?: PluginDbLogger) =>
          Promise.resolve(
            new Powerwall2LocalAdapter(
              api,
              60,
              ctx.deps.log,
              () => NOW,
              30,
              dbLog ?? ctx.deps.dbLog,
            ),
          ),
      );
      try {
        const logs = new LogService(ctx.db);
        const before = await logs.getPluginLogs({
          pluginId: "powerwall2_local",
        });

        expect((await ctx.plugin.testConnection(input)).success).toBe(!fails);
        expect(await logs.getPluginLogs({ pluginId: "powerwall2_local" }))
          .toEqual(before);
        expect(mocked.calls).toHaveLength(1);
      } finally {
        ctx.db.close();
      }
    });
  });

  it("reads status and telemetry once through the real adapter and client", async () => {
    const ctx = await pluginHarness();
    const api = new FakePowerwallApi(aggregates());
    const http = new FakePowerwallHttp()
      .queue(
        "/api/status",
        response(200, api.statusResponse),
        response(200, api.statusResponse),
      )
      .queue("/api/login/Basic", response(200, { token: "test-session" }))
      .queue(
        "/api/meters/aggregates",
        response(200, aggregates()),
        response(200, aggregates()),
      )
      .queue(
        "/api/system_status/soe",
        response(200, { percentage: 24 }),
        response(200, { percentage: 24 }),
      );
    using mocked = stub(
      ctx.plugin,
      "createAdapter",
      (_input, dbLog?: PluginDbLogger) =>
        Promise.resolve(
          new Powerwall2LocalAdapter(
            new PowerwallGatewayClient(
              input.host,
              input.email,
              input.password,
              http,
            ),
            60,
            ctx.deps.log,
            () => NOW,
            30,
            dbLog ?? ctx.deps.dbLog,
          ),
        ),
    );
    try {
      const result = await ctx.plugin.testConnection(input);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Expected successful connection");
      expect(result.device.model).toBe("26.10.0 test");
      expect(result.realtime.batterySoc).toBe(20);
      expect(http.requests.map(({ path }) => path)).toEqual([
        "/api/status",
        "/api/login/Basic",
        "/api/meters/aggregates",
        "/api/system_status/soe",
      ]);
      expect(http.closeCalls).toBe(1);
      expect(mocked.calls).toHaveLength(1);
      expect(
        (await new LogService(ctx.db).getPluginLogs({
          pluginId: "powerwall2_local",
        })).total,
      ).toBe(0);
    } finally {
      ctx.db.close();
    }
  });

  it("disconnects once after a real status request failure and returns a safe error", async () => {
    const ctx = await pluginHarness();
    const http = new FakePowerwallHttp().queue(
      "/api/status",
      new Error("PRIVATE_STATUS_MARKER"),
    );
    using mocked = stub(
      ctx.plugin,
      "createAdapter",
      (_input, dbLog?: PluginDbLogger) =>
        Promise.resolve(
          new Powerwall2LocalAdapter(
            new PowerwallGatewayClient(
              input.host,
              input.email,
              input.password,
              http,
            ),
            60,
            ctx.deps.log,
            () => NOW,
            30,
            dbLog ?? ctx.deps.dbLog,
          ),
        ),
    );
    try {
      expect(await ctx.plugin.testConnection(input)).toEqual({
        success: false,
        error:
          "Powerwall connection failed; check Gateway availability and credentials",
      });
      expect(http.requests.map(({ path }) => path)).toEqual(["/api/status"]);
      expect(http.closeCalls).toBe(1);
      expect(mocked.calls).toHaveLength(1);
      expect(
        (await new LogService(ctx.db).getPluginLogs({
          pluginId: "powerwall2_local",
        })).total,
      ).toBe(0);
    } finally {
      ctx.db.close();
    }
  });

  it("returns a safe structured factory failure", async () => {
    const ctx = await pluginHarness();
    using mocked = stub(
      ctx.plugin,
      "createAdapter",
      () => Promise.reject(new Error("PRIVATE_FACTORY_MARKER")),
    );
    try {
      expect(await ctx.plugin.testConnection(input)).toEqual({
        success: false,
        error:
          "Powerwall connection failed; check Gateway availability and credentials",
      });
      expect(mocked.calls).toHaveLength(1);
      expect(
        (await new LogService(ctx.db).getPluginLogs({
          pluginId: "powerwall2_local",
        })).total,
      ).toBe(0);
    } finally {
      ctx.db.close();
    }
  });
});
