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

  write(_data: unknown, _cb?: unknown): boolean {
    return true;
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
    // Would throw ERR_UNHANDLED_ERROR if connect() had removed the last 'error' listener.
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

  it("reports not-connected on reads after a failed connect", async () => {
    const socket = new FakeSocket();
    socket.connect = function () {
      queueMicrotask(() => this.emit("error", new Error("ECONNREFUSED")));
      return this;
    };
    const reader = makeReader(socket);

    await expect(reader.connect()).rejects.toThrow("Cannot reach Sigenergy");
    // A retained socket would hand back a client bound to a dead socket.
    await expect(reader.readInputRegisters(247, 30000, 2)).rejects.toThrow(
      "Modbus socket is not connected",
    );
    expect(socket.destroyed).toBe(true);
  });

  it("keeps an error handler attached when connect fails", async () => {
    const socket = new FakeSocket();
    socket.connect = function () {
      queueMicrotask(() => this.emit("error", new Error("ECONNREFUSED")));
      return this;
    };

    await expect(makeReader(socket).connect()).rejects.toThrow(
      "Cannot reach Sigenergy",
    );
    expect(socket.listenerCount("error")).toBeGreaterThan(0);
    // Would throw ERR_UNHANDLED_ERROR if the failure path left the socket bare.
    socket.emit("error", new Error("late ECONNRESET"));
  });

  it("destroys the socket on disconnect", async () => {
    const socket = new FakeSocket();
    const reader = makeReader(socket);
    await reader.connect();
    await reader.disconnect();

    expect(socket.destroyed).toBe(true);
  });

  describe("reconnecting", () => {
    const makeTrackedReader = () => {
      const sockets: FakeSocket[] = [];
      const reader = new JsmodbusReader(
        "10.0.0.5",
        502,
        [247, 1],
        testLogger,
        () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as Socket;
        },
      );
      return { reader, sockets };
    };

    it("keeps the socket when connect is called while connected", async () => {
      const { reader, sockets } = makeTrackedReader();
      await reader.connect();
      await reader.connect();
      expect(sockets).toHaveLength(1);
    });

    it("opens a new socket after the old one closes", async () => {
      const { reader, sockets } = makeTrackedReader();
      await reader.connect();
      sockets[0].emit("close");
      await expect(reader.readInputRegisters(247, 30035, 2)).rejects.toThrow(
        "Modbus socket is not connected",
      );
      await reader.connect();
      expect(sockets).toHaveLength(2);
    });

    it("ignores a late close from a replaced socket", async () => {
      const { reader, sockets } = makeTrackedReader();
      await reader.connect();
      await reader.disconnect();
      await reader.connect();
      sockets[0].emit("close");
      await reader.connect();
      expect(sockets).toHaveLength(2);
    });
  });

  it("reports the jsmodbus message when a read fails", async () => {
    const socket = new FakeSocket();
    const reader = makeReader(socket);
    await reader.connect();
    const read = reader.readInputRegisters(247, 30035, 2);
    socket.emit("close");
    await expect(read).rejects.toThrow(
      "Modbus read failed at 30035 (unit 247): connection to modbus server closed",
    );
  });
});
