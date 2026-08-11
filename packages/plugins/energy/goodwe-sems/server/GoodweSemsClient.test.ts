import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  GoodweSemsAuthError,
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "./GoodweSemsClient.ts";
import {
  type FetchMock,
  GATEWAY_API,
  LEGACY_LOGIN_PATH,
  loginOk,
  makeClient,
  NEW_LOGIN_PATH,
  REGION_API,
  semsCode,
  semsOk,
  setupFetchMock,
  STATION_DETAIL_PATH,
  STATION_LIST_PATH,
  stationDetailPayload,
} from "./test-helpers/goodweSemsHarness.ts";

describe("GoodweSemsClient", () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = setupFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("error classes", () => {
    const errorCases: Array<[new (msg: string) => Error, string]> = [
      [GoodweSemsAuthError, "GoodweSemsAuthError"],
      [GoodweSemsConnectionError, "GoodweSemsConnectionError"],
    ];

    errorCases.forEach(([ErrorClass, expectedName]) => {
      it(`${expectedName} sets name and message`, () => {
        const err = new ErrorClass("test");
        expect(err.name).toBe(expectedName);
        expect(err.message).toBe("test");
      });
    });

    it("GoodweSemsRateLimitError carries the backoff", () => {
      const err = new GoodweSemsRateLimitError(300_000);
      expect(err.name).toBe("GoodweSemsRateLimitError");
      expect(err.retryAfterMs).toBe(300_000);
    });
  });

  describe("login", () => {
    it("uses the SEMS+ endpoint first", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));

      await makeClient().login();

      expect(mock.fetchCalls.length).toBe(1);
      expect(mock.fetchCalls[0].url).toContain(NEW_LOGIN_PATH);
      expect(mock.fetchCalls[0].method).toBe("POST");
    });

    it("tries the regional SEMS+ host before the global one", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));

      await makeClient().login();

      expect(mock.fetchCalls[0].url).toContain("au-semsplus.goodwe.com");
    });

    it("falls back to the global SEMS+ host when the regional one rejects", async () => {
      mock.setPathResponse("au-semsplus.goodwe.com", semsCode("C0602"));
      mock.setPathResponse(
        "//semsplus.goodwe.com",
        loginOk("tok", GATEWAY_API),
      );

      await makeClient().login();

      expect(mock.fetchCalls.length).toBe(2);
      expect(mock.fetchCalls[1].url).toContain("//semsplus.goodwe.com");
    });

    it("sends the SEMS+ password base64-encoded rather than in the clear", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));

      await makeClient({ password: "secret123" }).login();

      const body = mock.fetchCalls[0].body;
      assertExists(body);
      expect(body).not.toContain("secret123");
      // base64 of the lowercase hex md5 of "secret123"
      expect(body).toContain(btoa("5d7845ac6ee7cfffafc5fe5f35cf666d"));
    });

    it("falls back to the legacy endpoint when SEMS+ rejects the account", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsCode("100005"));
      mock.setPathResponse(LEGACY_LOGIN_PATH, loginOk("tok", REGION_API));

      await makeClient().login();

      // Two SEMS+ attempts (regional then global), then legacy.
      expect(mock.fetchCalls.length).toBe(3);
      expect(mock.fetchCalls[2].url).toContain(LEGACY_LOGIN_PATH);
    });

    it("sends the plain password and bootstrap token on the legacy endpoint", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsCode("100005"));
      mock.setPathResponse(LEGACY_LOGIN_PATH, loginOk("tok", REGION_API));

      await makeClient({ password: "secret123" }).login();

      const legacy = mock.fetchCalls[2];
      expect(legacy.body).toContain("secret123");
      expect(legacy.headers.token).toContain("ios");
    });

    it("falls back to legacy when the SEMS+ endpoint is unreachable", async () => {
      // No override registered for the SEMS+ hosts, so both answer 404.
      mock.setPathResponse(LEGACY_LOGIN_PATH, loginOk("tok", REGION_API));

      await makeClient().login();

      expect(mock.fetchCalls.length).toBe(3);
      expect(mock.fetchCalls[2].url).toContain(LEGACY_LOGIN_PATH);
    });

    it("prefers the mode that last worked on the next login", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsCode("100005"));
      mock.setPathResponse(LEGACY_LOGIN_PATH, loginOk("tok", REGION_API));

      const client = makeClient();
      await client.login();
      await client.login();

      expect(mock.fetchCalls.length).toBe(4);
      expect(mock.fetchCalls[3].url).toContain(LEGACY_LOGIN_PATH);
    });

    it("throws GoodweSemsAuthError when both modes reject", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsCode("100005"));
      mock.setPathResponse(LEGACY_LOGIN_PATH, semsCode("100005"));

      await expect(makeClient().login()).rejects.toBeInstanceOf(
        GoodweSemsAuthError,
      );
    });

    it("throws GoodweSemsAuthError when a login succeeds with no token", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsOk({ api: GATEWAY_API }));
      mock.setPathResponse(LEGACY_LOGIN_PATH, semsOk({ api: REGION_API }));

      await expect(makeClient().login()).rejects.toBeInstanceOf(
        GoodweSemsAuthError,
      );
    });

    it("throws GoodweSemsAuthError when a legacy login returns no api base", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsCode("100005"));
      mock.setPathResponse(LEGACY_LOGIN_PATH, semsOk({ token: "tok" }));

      await expect(makeClient().login()).rejects.toBeInstanceOf(
        GoodweSemsAuthError,
      );
    });

    it("surfaces a rate limit rather than falling through to legacy", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsCode("GY0429"));
      mock.setPathResponse(LEGACY_LOGIN_PATH, loginOk("tok", REGION_API));

      await expect(makeClient().login()).rejects.toBeInstanceOf(
        GoodweSemsRateLimitError,
      );
      expect(mock.fetchCalls.length).toBe(1);
    });
  });

  describe("getStationDetail", () => {
    it("shares one login across concurrent calls", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk(stationDetailPayload));

      const client = makeClient();
      await Promise.all([
        client.getStationDetail("station-1"),
        client.getStationDetail("station-1"),
      ]);

      const loginCalls = mock.fetchCalls.filter((c) =>
        c.url.includes(NEW_LOGIN_PATH)
      );
      expect(loginCalls.length).toBe(1);
    });

    it("rewrites PowerStation routes off a SEMS+ gateway base onto the region", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk(stationDetailPayload));

      await makeClient().getStationDetail("station-1");

      const detailCall = mock.fetchCalls.find((c) =>
        c.url.includes(STATION_DETAIL_PATH)
      );
      assertExists(detailCall);
      expect(detailCall.url).toBe(REGION_API + STATION_DETAIL_PATH);
      expect(detailCall.body).toContain("station-1");
    });

    it("prefers the token's own region over the host when rewriting", async () => {
      mock.setPathResponse(
        NEW_LOGIN_PATH,
        semsOk({ token: "tok", api: GATEWAY_API, region: "us" }, GATEWAY_API),
      );
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk(stationDetailPayload));

      await makeClient().getStationDetail("station-1");

      const detailCall = mock.fetchCalls.find((c) =>
        c.url.includes(STATION_DETAIL_PATH)
      );
      assertExists(detailCall);
      expect(detailCall.url).toContain("https://us.semsportal.com/api");
    });

    it("leaves a regional portal base alone", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, semsCode("100005"));
      mock.setPathResponse(LEGACY_LOGIN_PATH, loginOk("tok", REGION_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk(stationDetailPayload));

      await makeClient().getStationDetail("station-1");

      const detailCall = mock.fetchCalls.find((c) =>
        c.url.includes(STATION_DETAIL_PATH)
      );
      assertExists(detailCall);
      expect(detailCall.url).toBe(REGION_API + STATION_DETAIL_PATH);
    });

    it("sends the login token verbatim as the token header", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk(stationDetailPayload));

      await makeClient().getStationDetail("station-1");

      const detailCall = mock.fetchCalls.find((c) =>
        c.url.includes(STATION_DETAIL_PATH)
      );
      assertExists(detailCall);
      expect(JSON.parse(detailCall.headers.token).token).toBe("tok");
    });

    it("maps the payload onto SemsStationDetail", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk(stationDetailPayload));

      const detail = await makeClient().getStationDetail("station-1");

      expect(detail.hasPowerflow).toBe(true);
      expect(detail.stationName).toBe("Home");
      expect(detail.inverterModel).toBe("GW10KAU-DT");
      expect(detail.powerflow?.pv).toBe("3000(W)");
    });

    it("drops the power flow block when hasPowerflow is false", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(
        STATION_DETAIL_PATH,
        semsOk({ ...stationDetailPayload, hasPowerflow: false }),
      );

      const detail = await makeClient().getStationDetail("station-1");

      expect(detail.hasPowerflow).toBe(false);
      expect(detail.powerflow).toBeNull();
    });

    it("throws GoodweSemsRateLimitError on GY0429", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsCode("GY0429"));

      await expect(makeClient().getStationDetail("station-1")).rejects
        .toBeInstanceOf(GoodweSemsRateLimitError);
    });

    it("does not retry after a rate limit", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsCode("GY0429"));

      await expect(makeClient().getStationDetail("station-1")).rejects
        .toBeInstanceOf(GoodweSemsRateLimitError);

      const detailCalls = mock.fetchCalls.filter((c) =>
        c.url.includes(STATION_DETAIL_PATH)
      );
      expect(detailCalls.length).toBe(1);
    });

    it("re-logs in once and retries when the token has gone stale", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.queuePathResponses(STATION_DETAIL_PATH, [
        semsCode("100002"),
        semsOk(stationDetailPayload),
      ]);

      const detail = await makeClient().getStationDetail("station-1");

      expect(detail.stationName).toBe("Home");
      const loginCalls = mock.fetchCalls.filter((c) =>
        c.url.includes(NEW_LOGIN_PATH)
      );
      const detailCalls = mock.fetchCalls.filter((c) =>
        c.url.includes(STATION_DETAIL_PATH)
      );
      expect(loginCalls.length).toBe(2);
      expect(detailCalls.length).toBe(2);
    });

    it("does not re-login on a failure code that is not a stale token", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsCode("100005"));

      await expect(makeClient().getStationDetail("station-1")).rejects
        .toBeInstanceOf(GoodweSemsConnectionError);
      const loginCalls = mock.fetchCalls.filter((c) =>
        c.url.includes(NEW_LOGIN_PATH)
      );
      expect(loginCalls.length).toBe(1);
    });

    it("retries an empty response only once per cooldown window", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk({}));

      const client = makeClient();
      await client.getStationDetail("station-1");
      const callsAfterFirst =
        mock.fetchCalls.filter((c) => c.url.includes(STATION_DETAIL_PATH))
          .length;
      await client.getStationDetail("station-1");
      const callsAfterSecond =
        mock.fetchCalls.filter((c) => c.url.includes(STATION_DETAIL_PATH))
          .length;

      expect(callsAfterFirst).toBe(2);
      expect(callsAfterSecond).toBe(3);
    });

    it("treats an empty data block as a failure and retries once", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.queuePathResponses(STATION_DETAIL_PATH, [
        semsOk({}),
        semsOk(stationDetailPayload),
      ]);

      const detail = await makeClient().getStationDetail("station-1");

      expect(detail.stationName).toBe("Home");
    });

    it("throws GoodweSemsConnectionError when the retry also fails", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsCode("100002"));

      await expect(makeClient().getStationDetail("station-1")).rejects
        .toBeInstanceOf(GoodweSemsConnectionError);

      const detailCalls = mock.fetchCalls.filter((c) =>
        c.url.includes(STATION_DETAIL_PATH)
      );
      expect(detailCalls.length).toBe(2);
    });

    it("throws GoodweSemsConnectionError on a non-OK HTTP status", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, {
        ok: false,
        status: 500,
        json: {},
      });

      await expect(makeClient().getStationDetail("station-1")).rejects
        .toBeInstanceOf(GoodweSemsConnectionError);
    });

    it("throws GoodweSemsConnectionError on an unrecognised payload shape", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk("not-an-object"));

      await expect(makeClient().getStationDetail("station-1")).rejects
        .toBeInstanceOf(GoodweSemsConnectionError);
    });
  });

  describe("getStations", () => {
    it("posts no body to the station-list route", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_LIST_PATH, semsOk([{ id: "s1" }]));

      await makeClient().getStations();

      const listCall = mock.fetchCalls.find((c) =>
        c.url.includes(STATION_LIST_PATH)
      );
      assertExists(listCall);
      expect(listCall.body).toBeUndefined();
    });

    it("maps id and stationname", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(
        STATION_LIST_PATH,
        semsOk([{ id: "s1", stationname: "Home" }]),
      );

      expect(await makeClient().getStations()).toEqual([
        { id: "s1", name: "Home" },
      ]);
    });

    it("accepts powerstation_id as the id and falls back to it for the name", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(
        STATION_LIST_PATH,
        semsOk([{ powerstation_id: "s2" }]),
      );

      expect(await makeClient().getStations()).toEqual([
        { id: "s2", name: "s2" },
      ]);
    });

    it("skips entries with no id at all", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(
        STATION_LIST_PATH,
        semsOk([{ stationname: "Nameless" }, { id: "s3" }]),
      );

      expect(await makeClient().getStations()).toEqual([
        { id: "s3", name: "s3" },
      ]);
    });

    it("treats a bare station-id string as a single station", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_LIST_PATH, semsOk("station-uuid-1"));

      expect(await makeClient().getStations()).toEqual([
        { id: "station-uuid-1", name: "station-uuid-1" },
      ]);
    });

    it("returns an empty list when the payload is not an array", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_LIST_PATH, semsOk({ unexpected: true }));

      expect(await makeClient().getStations()).toEqual([]);
    });

    it("returns an empty list for an owner with no stations", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_LIST_PATH, semsOk([]));

      // An empty data block normally means a stale token, so the call retries
      // once with fresh credentials. Still empty means the account really has
      // no stations — an empty list, not a connection error.
      expect(await makeClient().getStations()).toEqual([]);
    });
  });

  describe("clearSession", () => {
    it("forces a fresh login on the next call", async () => {
      mock.setPathResponse(NEW_LOGIN_PATH, loginOk("tok", GATEWAY_API));
      mock.setPathResponse(STATION_DETAIL_PATH, semsOk(stationDetailPayload));

      const client = makeClient();
      await client.getStationDetail("station-1");
      client.clearSession();
      await client.getStationDetail("station-1");

      const loginCalls = mock.fetchCalls.filter((c) =>
        c.url.includes(NEW_LOGIN_PATH)
      );
      expect(loginCalls.length).toBe(2);
    });
  });
});
