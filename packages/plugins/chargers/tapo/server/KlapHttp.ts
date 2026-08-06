/// <reference lib="deno.ns" />
import { KlapCrypto } from "./KlapCrypto.ts";
import { TapoConnectionError } from "./errors.ts";

export interface KlapHttpResponse {
  status: number;
  ok: boolean;
  setCookie: string | null;
  body: Uint8Array<ArrayBuffer>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_PORT = 80;
const READ_CHUNK = 4096;
const CR = 13;
const LF = 10;

/**
 * Minimal HTTP/1.1 POST over a raw TCP socket — the transport for every KLAP
 * exchange.
 *
 * Tapo's embedded "SHIP 2.0" server matches the `Content-Length` header name
 * case-sensitively and answers 400 Bad Request to anything else. The WHATWG
 * fetch spec requires header names to be lowercased on the wire, so Deno's
 * fetch emits `content-length` and can never complete a handshake against
 * these devices. Casing is not controllable through fetch, so KLAP writes its
 * own requests. Verified against a P110(AU) on firmware 1.4.x: `Content-Length`
 * → 200 + 48 bytes, `content-length` → 400, otherwise identical requests.
 *
 * Responses are parsed case-insensitively — the device is the strict one here,
 * not us.
 */
export class KlapHttp {
  static async post(
    host: string,
    path: string,
    body: Uint8Array<ArrayBuffer>,
    cookie: string | null,
    timeoutMs: number,
  ): Promise<KlapHttpResponse> {
    const deadline = Date.now() + timeoutMs;
    const { hostname, port } = splitHostPort(host);
    const conn = await connect(hostname, port, deadline);
    try {
      await writeAll(conn, buildRequest(host, path, body, cookie), deadline);
      return toResponse(await readResponse(conn, deadline, new Uint8Array(0)));
    } finally {
      closeQuietly(conn);
    }
  }
}

function splitHostPort(host: string): { hostname: string; port: number } {
  const [hostname, port] = host.split(":");
  const parsed = parseInt(port ?? "", 10);
  return {
    hostname,
    port: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT,
  };
}

/** Header names are capitalised deliberately — see the class doc comment. */
function buildRequest(
  host: string,
  path: string,
  body: Uint8Array<ArrayBuffer>,
  cookie: string | null,
): Uint8Array<ArrayBuffer> {
  const lines = [
    `POST ${path} HTTP/1.1`,
    `Host: ${host}`,
    "Content-Type: application/octet-stream",
    `Content-Length: ${body.length}`,
    "Connection: close",
    ...(cookie ? [`Cookie: ${cookie}`] : []),
  ];
  return KlapCrypto.concatBytes(
    encoder.encode(`${lines.join("\r\n")}\r\n\r\n`),
    body,
  );
}

async function connect(
  hostname: string,
  port: number,
  deadline: number,
): Promise<Deno.TcpConn> {
  try {
    return await withDeadline(Deno.connect({ hostname, port }), deadline);
  } catch (error) {
    throw new TapoConnectionError(
      `Cannot reach Tapo device at ${hostname}:${port}`,
      error instanceof Error ? error : undefined,
    );
  }
}

/** conn.write may accept only part of the buffer; drain the remainder. */
async function writeAll(
  conn: Deno.TcpConn,
  data: Uint8Array<ArrayBuffer>,
  deadline: number,
): Promise<void> {
  const written = await withDeadline(conn.write(data), deadline);
  if (written >= data.length) return;
  return await writeAll(conn, data.slice(written), deadline);
}

async function readResponse(
  conn: Deno.TcpConn,
  deadline: number,
  received: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (isComplete(received)) return received;
  const buf = new Uint8Array(READ_CHUNK);
  const read = await withDeadline(conn.read(buf), deadline);
  if (read === null) return received; // EOF — Connection: close
  return await readResponse(
    conn,
    deadline,
    KlapCrypto.concatBytes(received, buf.slice(0, read)),
  );
}

/** Byte offset of the CRLFCRLF terminating the headers, or -1. */
function headerEndIndex(bytes: Uint8Array<ArrayBuffer>): number {
  return bytes.findIndex((b, i) =>
    b === CR && bytes[i + 1] === LF && bytes[i + 2] === CR &&
    bytes[i + 3] === LF
  );
}

interface ParsedHead {
  status: number;
  setCookie: string | null;
  contentLength: number | null;
  headerBytes: number;
}

function parseHead(bytes: Uint8Array<ArrayBuffer>, end: number): ParsedHead {
  const [statusLine, ...headerLines] = decoder
    .decode(bytes.slice(0, end))
    .split("\r\n");
  const status = parseInt(statusLine.split(" ")[1] ?? "", 10);
  const header = (name: string): string | null =>
    headerLines
      .find((line) => line.toLowerCase().startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim() ?? null;
  const contentLength = parseInt(header("content-length") ?? "", 10);
  return {
    status: Number.isFinite(status) ? status : 0,
    setCookie: header("set-cookie"),
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    headerBytes: end + 4,
  };
}

function isComplete(received: Uint8Array<ArrayBuffer>): boolean {
  const end = headerEndIndex(received);
  if (end < 0) return false;
  const head = parseHead(received, end);
  return head.contentLength !== null &&
    received.length - head.headerBytes >= head.contentLength;
}

function toResponse(received: Uint8Array<ArrayBuffer>): KlapHttpResponse {
  const end = headerEndIndex(received);
  if (end < 0) {
    throw new TapoConnectionError("Truncated HTTP response from Tapo device");
  }
  const head = parseHead(received, end);
  return {
    status: head.status,
    ok: head.status >= 200 && head.status < 300,
    setCookie: head.setCookie,
    body: received.slice(
      head.headerBytes,
      head.contentLength === null
        ? undefined
        : head.headerBytes + head.contentLength,
    ),
  };
}

/** Reject once the deadline passes, always clearing the timer so tests do not
 *  trip Deno's timer sanitizer. */
function withDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  const timer = Promise.withResolvers<never>();
  const handle = setTimeout(
    () => timer.reject(new TapoConnectionError("Tapo device timed out")),
    Math.max(deadline - Date.now(), 0),
  );
  return Promise.race([work, timer.promise])
    .finally(() => clearTimeout(handle));
}

function closeQuietly(conn: Deno.TcpConn): void {
  try {
    conn.close();
  } catch (error) {
    // Peer or deadline already tore the socket down — nothing left to release.
    if (!(error instanceof Deno.errors.BadResource)) throw error;
  }
}
