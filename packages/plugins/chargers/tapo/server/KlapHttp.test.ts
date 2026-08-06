// KlapHttp exists because Tapo's embedded "SHIP 2.0" server matches the
// `Content-Length` header name case-sensitively, and Deno's fetch is required
// by the WHATWG spec to lowercase it — so fetch can never handshake with these
// devices (verified on a P110(AU): `Content-Length` → 200, `content-length` →
// 400 Bad Request, otherwise byte-identical requests).
//
// These tests assert the raw bytes we put on the wire rather than round-tripping
// through a lenient server: Deno.serve normalises header casing, so a test built
// on it would keep passing after a regression back to fetch.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { KlapHttp } from "./KlapHttp.ts";
import { TapoConnectionError } from "./errors.ts";

interface RawServer {
  host: string;
  /** Raw request text, one entry per accepted connection. */
  seen: string[];
  stop: () => Promise<void>;
}

describe("KlapHttp", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /** A TCP server that returns caller-supplied bytes verbatim, so tests control
   *  the exact response framing. Chunks are written separately to exercise
   *  reassembly across TCP segments. */
  const startRawServer = (
    respond: (request: string) => Uint8Array[],
  ): RawServer => {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const seen: string[] = [];

    const accept = (): Promise<void> =>
      listener.accept()
        .then(async (conn) => {
          const buf = new Uint8Array(8192);
          const read = await conn.read(buf) ?? 0;
          const request = decoder.decode(buf.slice(0, read));
          seen.push(request);
          await respond(request).reduce(
            (prev, chunk) =>
              prev.then(async () => {
                await conn.write(chunk);
              }),
            Promise.resolve(),
          );
          conn.close();
          return await accept();
        })
        .catch((error) => {
          // stop() closes the listener out from under the pending accept.
          if (error instanceof Deno.errors.BadResource) return;
          throw error;
        });

    const running = accept();
    return {
      host: `127.0.0.1:${(listener.addr as Deno.NetAddr).port}`,
      seen,
      stop: async () => {
        listener.close();
        await running;
      },
    };
  };

  const withServer = async (
    respond: (request: string) => Uint8Array[],
    run: (server: RawServer) => Promise<void>,
  ): Promise<void> => {
    const server = startRawServer(respond);
    try {
      await run(server);
    } finally {
      await server.stop();
    }
  };

  const seed16 = (): Uint8Array<ArrayBuffer> =>
    crypto.getRandomValues(new Uint8Array(16));

  /** 48-byte handshake1 reply: 16-byte remote seed + 32-byte server hash. */
  const handshake1Reply = (): Uint8Array[] => [
    encoder.encode(
      "HTTP/1.1 200 OK\r\nServer: SHIP 2.0\r\n" +
        "Set-Cookie: TP_SESSIONID=ABC123;TIMEOUT=86400\r\n" +
        "Content-Length: 48\r\n\r\n",
    ),
    new Uint8Array(48).fill(7),
  ];

  const post = (host: string, path: string, cookie: string | null, ms = 2000) =>
    KlapHttp.post(host, path, seed16(), cookie, ms);

  it("capitalises Content-Length — SHIP 2.0 400s the lowercase form", async () => {
    await withServer(handshake1Reply, async (server) => {
      await post(server.host, "/app/handshake1", null);
      expect(server.seen[0]).toContain("\r\nContent-Length: 16\r\n");
      expect(server.seen[0]).not.toContain("content-length:");
    });
  });

  it("parses status, body and Set-Cookie off the response", async () => {
    await withServer(handshake1Reply, async (server) => {
      const res = await post(server.host, "/app/handshake1", null);
      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
      expect(res.body.length).toBe(48);
      expect(res.setCookie).toContain("TP_SESSIONID=ABC123");
    });
  });

  it("reassembles a body split across TCP segments", async () => {
    const chunked = () => [
      encoder.encode("HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\n"),
      encoder.encode("abc"),
      encoder.encode("def"),
    ];
    await withServer(chunked, async (server) => {
      const res = await post(server.host, "/app/x", null);
      expect(decoder.decode(res.body)).toBe("abcdef");
    });
  });

  it("sends the session cookie only when one is supplied", async () => {
    await withServer(handshake1Reply, async (server) => {
      await post(server.host, "/app/request?seq=1", "TP_SESSIONID=Z9");
      await post(server.host, "/app/handshake1", null);
      expect(server.seen[0]).toContain("\r\nCookie: TP_SESSIONID=Z9\r\n");
      expect(server.seen[1]).not.toContain("Cookie:");
    });
  });

  it("returns a non-2xx status instead of throwing, so callers can branch", async () => {
    const forbidden = () => [
      encoder.encode("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"),
    ];
    await withServer(forbidden, async (server) => {
      const res = await post(server.host, "/app/handshake1", null);
      expect(res.status).toBe(403);
      expect(res.ok).toBe(false);
      expect(res.body.length).toBe(0);
    });
  });

  it("terminates on EOF when the response carries no Content-Length", async () => {
    const noLength =
      () => [encoder.encode("HTTP/1.1 200 OK\r\n\r\nbody-bytes")];
    await withServer(noLength, async (server) => {
      const res = await post(server.host, "/app/x", null);
      expect(decoder.decode(res.body)).toBe("body-bytes");
    });
  });

  it("wraps an unreachable device in TapoConnectionError", async () => {
    // Port 1 on loopback: reserved and never listening, so connect() refuses
    // immediately instead of waiting out the timeout.
    await expect(post("127.0.0.1:1", "/app/handshake1", null))
      .rejects.toBeInstanceOf(TapoConnectionError);
  });

  it("gives up on a device that accepts the socket then never replies", async () => {
    await withServer(() => [], async (server) => {
      await expect(post(server.host, "/app/handshake1", null, 300))
        .rejects.toBeInstanceOf(TapoConnectionError);
    });
  });
});
