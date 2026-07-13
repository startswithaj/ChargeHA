import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { JsmodbusReader } from "./SigenergyModbusClient.ts";

/** Minimal socket fake: enough surface for jsmodbus.client.TCP and
 *  JsmodbusReader.connect(). Emitting 'error' with no listener attached
 *  throws synchronously, exactly like node:net — which is what the
 *  persistent-error-handler regression test relies on. */
class FakeSocket extends EventEmitter {
  destroyed = false;

  connect(_opts: { host: string; port: number }): this {
    queueMicrotask(() => this.emit("connect"));
    return this;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

describe("JsmodbusReader", () => {
  const testLogger = new Logger("SigenergyModbus", "error");

  const makeReader = (socket: FakeSocket) =>
    new JsmodbusReader(
      "10.0.0.5",
      502,
      [247, 1],
      testLogger,
      () => socket as unknown as Socket,
    );

  it("keeps an error handler on the socket after connect", async () => {
    const socket = new FakeSocket();
    await makeReader(socket).connect();

    expect(socket.listenerCount("error")).toBeGreaterThan(0);
    // Would throw ERR_UNHANDLED_ERROR (crashing the process in production)
    // if connect() had removed the last 'error' listener.
    socket.emit("error", new Error("read ECONNRESET"));
  });

  it("rejects connect when the socket errors before connecting", async () => {
    const socket = new FakeSocket();
    socket.connect = function () {
      queueMicrotask(() => this.emit("error", new Error("ECONNREFUSED")));
      return this;
    };

    await expect(makeReader(socket).connect()).rejects.toThrow(
      "Cannot reach Sigenergy at 10.0.0.5:502",
    );
  });

  it("destroys the socket on disconnect", async () => {
    const socket = new FakeSocket();
    const reader = makeReader(socket);
    await reader.connect();
    await reader.disconnect();

    expect(socket.destroyed).toBe(true);
  });
});
