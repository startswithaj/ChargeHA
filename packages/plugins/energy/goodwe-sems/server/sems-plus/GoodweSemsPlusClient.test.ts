import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  GoodweSemsAuthError,
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "../errors.ts";
import { GoodweSemsPlusClient } from "./GoodweSemsPlusClient.ts";
import {
  buildSemsPlusFlow,
  type FetchMock,
  type MockResp,
  semsCode,
  semsOk,
  setupFetchMock,
  testDbLogger,
  testLogger,
} from "../test-helpers/goodweSemsHarness.ts";

describe("GoodweSemsPlusClient", () => {
  const LOGIN_PATH = "sems-user/api/v1/auth/cross-login";
  const FLOW_PATH = "sems-plant/api/stations/flow";
  const GATEWAY_API = "https://au-gateway.semsportal.com/web/sems";

  const loginOk = (api: string = GATEWAY_API): MockResp =>
    semsOk({ token: "inner-token", uid: "uid-1", api }, api);

  const makeSemsPlus = (): GoodweSemsPlusClient =>
    new GoodweSemsPlusClient(
      "user@example.com",
      "secret123",
      testLogger,
      testDbLogger,
    );

  let mock: FetchMock;

  beforeEach(() => {
    mock = setupFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  it("resolves the global login host to the au gateway, not a fabricated region", async () => {
    mock.setPathResponse(
      LOGIN_PATH,
      loginOk("https://semsplus.goodwe.com/web/sems"),
    );
    mock.setPathResponse(FLOW_PATH, semsOk(buildSemsPlusFlow()));

    await makeSemsPlus().getFlow("station-1");

    const flowCall = mock.fetchCalls.find((call) =>
      call.url.includes(FLOW_PATH)
    );
    expect(flowCall?.url).toContain("https://au-gateway.semsportal.com");
  });

  it("logs in and fetches the flow from the gateway", async () => {
    mock.setPathResponse(LOGIN_PATH, loginOk());
    mock.setPathResponse(FLOW_PATH, semsOk(buildSemsPlusFlow()));

    const flow = await makeSemsPlus().getFlow("station-1");

    expect(flow.pSystem).toBe(5.153);
    expect(flow.pGrid).toBe(3.837);
    const flowCall = mock.fetchCalls.find((call) =>
      call.url.includes(FLOW_PATH)
    );
    expect(flowCall).toBeDefined();
    expect(flowCall?.url).toContain(GATEWAY_API);
    expect(flowCall?.url).toContain("stationId=station-1");
    expect(flowCall?.headers["X-Signature"]).toBeDefined();
    expect(flowCall?.headers["token"]).toContain('"client":"semsPlusWeb"');
  });

  it("falls through to the second login host when the first is down", async () => {
    mock.queuePathResponses(LOGIN_PATH, [
      { ok: false, status: 503, json: null },
      loginOk(),
    ]);
    mock.setPathResponse(FLOW_PATH, semsOk(buildSemsPlusFlow()));

    const flow = await makeSemsPlus().getFlow("station-1");

    expect(flow.pConsum).toBe(1.316);
    const loginCalls = mock.fetchCalls.filter((call) =>
      call.url.includes(LOGIN_PATH)
    );
    expect(loginCalls.length).toBe(2);
    expect(loginCalls[0].url).toContain("au-semsplus.goodwe.com");
    expect(loginCalls[1].url).toContain("https://semsplus.goodwe.com");
  });

  it("throws an auth error when every login host rejects", async () => {
    mock.setPathResponse(LOGIN_PATH, semsCode("100001"));

    await expect(makeSemsPlus().getFlow("station-1")).rejects.toThrow(
      GoodweSemsAuthError,
    );
  });

  it("stops at the first host that definitively rejects the credentials", async () => {
    mock.setPathResponse(LOGIN_PATH, semsCode("100005"));

    await expect(makeSemsPlus().getFlow("station-1")).rejects.toThrow(
      GoodweSemsAuthError,
    );

    const loginCalls = mock.fetchCalls.filter((call) =>
      call.url.includes(LOGIN_PATH)
    );
    expect(loginCalls.length).toBe(1);
  });

  it("holds a rejected-login cooldown instead of retrying every poll", async () => {
    mock.setPathResponse(LOGIN_PATH, semsCode("100005"));
    const client = makeSemsPlus();

    await expect(client.getFlow("station-1")).rejects.toThrow(
      GoodweSemsAuthError,
    );
    await expect(client.getFlow("station-1")).rejects.toThrow(
      GoodweSemsAuthError,
    );

    const loginCalls = mock.fetchCalls.filter((call) =>
      call.url.includes(LOGIN_PATH)
    );
    expect(loginCalls.length).toBe(1);
  });

  it("reports unreachable, not bad credentials, when no host answers", async () => {
    await expect(makeSemsPlus().getFlow("station-1")).rejects.toThrow(
      "SEMS+ is unreachable",
    );
  });

  it("re-logs-in once on a stale token code", async () => {
    mock.setPathResponse(LOGIN_PATH, loginOk());
    mock.queuePathResponses(FLOW_PATH, [
      semsCode("100002"),
      semsOk(buildSemsPlusFlow()),
    ]);

    const flow = await makeSemsPlus().getFlow("station-1");

    expect(flow.pAc).toBe(5.153);
    const loginCalls = mock.fetchCalls.filter((call) =>
      call.url.includes(LOGIN_PATH)
    );
    expect(loginCalls.length).toBe(2);
  });

  it("surfaces GY0429 as a rate limit error", async () => {
    mock.setPathResponse(LOGIN_PATH, loginOk());
    mock.setPathResponse(FLOW_PATH, semsCode("GY0429"));

    await expect(makeSemsPlus().getFlow("station-1")).rejects.toThrow(
      GoodweSemsRateLimitError,
    );
  });

  it("rejects a flow payload in an unrecognised shape", async () => {
    mock.setPathResponse(LOGIN_PATH, loginOk());
    mock.setPathResponse(FLOW_PATH, semsOk({ pGrid: "not-a-number" }));

    await expect(makeSemsPlus().getFlow("station-1")).rejects.toThrow(
      GoodweSemsConnectionError,
    );
  });

  it("rejects an empty flow payload rather than reporting all zeros", async () => {
    mock.setPathResponse(LOGIN_PATH, loginOk());
    mock.setPathResponse(FLOW_PATH, semsOk({}));

    await expect(makeSemsPlus().getFlow("station-1")).rejects.toThrow(
      "SEMS+ returned no power flow data",
    );
  });

  it("reuses the session token across calls", async () => {
    mock.setPathResponse(LOGIN_PATH, loginOk());
    mock.setPathResponse(FLOW_PATH, semsOk(buildSemsPlusFlow()));

    const client = makeSemsPlus();
    await client.getFlow("station-1");
    await client.getFlow("station-1");

    const loginCalls = mock.fetchCalls.filter((call) =>
      call.url.includes(LOGIN_PATH)
    );
    expect(loginCalls.length).toBe(1);
  });
});
