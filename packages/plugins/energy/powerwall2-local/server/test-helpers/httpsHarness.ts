import https from "node:https";
import type { RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { throwingMock } from "../../../../../server/src/test-helpers/throwingMock.ts";
import { stub } from "@std/testing/mock";

type Mode = "success" | "timeout" | "error" | "interrupted" | "hang";

export function httpsHarness(mode: Mode) {
  const options: RequestOptions[] = [];
  const writes: string[] = [];
  const state = { destroyed: false };
  const exchanges: ReturnType<typeof exchange>[] = [];
  function exchange(callback: (response: IncomingMessage) => void) {
    const request = new EventEmitter();
    const response = new EventEmitter();
    const destroyed = { requests: 0, responses: 0 };
    const incoming: IncomingMessage = throwingMock<IncomingMessage>(
      "IncomingMessage",
      {
        statusCode: 200,
        headers: { "set-cookie": ["AuthCookie=test; Path=/"] },
        on: (
          event: string | symbol,
          listener: (...args: unknown[]) => void,
        ) => {
          response.on(event, listener);
          return incoming;
        },
        destroy: () => {
          destroyed.responses++;
          response.emit("error", new Error("late response closed"));
          return incoming;
        },
      },
    );
    const reply = () => callback(incoming);
    const finish = () => {
      reply();
      response.emit("data", new TextEncoder().encode('{"ok":'));
      response.emit("data", new TextEncoder().encode("true}"));
      response.emit("end");
    };
    const outgoing: ClientRequest = throwingMock<ClientRequest>(
      "ClientRequest",
      {
        on: (
          event: string | symbol,
          listener: (...args: unknown[]) => void,
        ) => {
          request.on(event, listener);
          return outgoing;
        },
        write: (body) => {
          writes.push(String(body));
          return true;
        },
        destroy: (error?: Error) => {
          state.destroyed = true;
          destroyed.requests++;
          request.emit("error", error ?? new Error("socket hang up"));
          return outgoing;
        },
        end: () => {
          queueMicrotask(() => {
            if (mode === "hang") return;
            if (mode === "timeout") {
              request.emit("timeout");
              return;
            }
            if (mode === "error") {
              request.emit("error", new Error("ECONNREFUSED"));
              return;
            }
            if (mode === "interrupted") {
              reply();
              response.emit("error", new Error("aborted"));
              return;
            }
            finish();
          });
          return outgoing;
        },
      },
    );
    return { outgoing, request, response, reply, finish, destroyed };
  }
  const implementation =
    ((opts: RequestOptions, callback: (response: IncomingMessage) => void) => {
      options.push(opts);
      const next = exchange(callback);
      exchanges.push(next);
      return next.outgoing;
    }) as typeof https.request;
  const mocked = stub(https, "request", implementation);
  return { options, writes, state, exchanges, restore: () => mocked.restore() };
}
