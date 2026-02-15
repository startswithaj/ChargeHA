import { TeslaProxyManager } from "../TeslaProxyManager.ts";

/**
 * Replaces TeslaProxyManager lifecycle methods so tests never shell out to
 * `openssl` or the `tesla-http-proxy` binary when a router call triggers
 * `restart()` (generateKeys / importKeys).
 */
export class StubTeslaProxyManager extends TeslaProxyManager {
  override start(): Promise<boolean> {
    return Promise.resolve(true);
  }
  override stop(): Promise<void> {
    return Promise.resolve();
  }
  override restart(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
