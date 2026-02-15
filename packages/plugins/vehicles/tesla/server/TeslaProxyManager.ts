/// <reference lib="deno.ns" />
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { Logger } from "@chargeha/server/lib/Logger";

/**
 * Manages the tesla-http-proxy process lifecycle.
 * Extracts the private key from the DB, writes it to a temp file,
 * and spawns the proxy process. Can be started at boot or after
 * the wizard generates/imports keys.
 */
export class TeslaProxyManager {
  private process: Deno.ChildProcess | null = null;
  private pemPath: string | null = null;

  constructor(
    private deps: PluginDependencies,
    private logger: Logger,
    private binaryPath = "tesla-http-proxy",
    private port = 4443,
  ) {}

  /** Returns true if the proxy process is currently running. */
  get isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * Try to start the proxy. Reads the private key from the DB,
   * writes it to a temp file, generates TLS certs if needed,
   * and spawns tesla-http-proxy.
   *
   * No-ops if already running or no key exists in the DB.
   */
  async start(): Promise<boolean> {
    if (this.process) {
      this.logger.debug("Tesla proxy already running, skipping start");
      return true;
    }

    // Read private key from DB
    const privateKeyPem = await this.deps.getSecret("ec_private_key");

    if (!privateKeyPem) {
      this.logger.info(
        "No Tesla private key in DB, skipping proxy start",
      );
      return false;
    }

    this.logger.info("Tesla private key found in DB, starting proxy...");

    // Write PEM to a temp file
    const tempDir = await Deno.makeTempDir({ prefix: "chargeha-proxy-" });
    this.pemPath = `${tempDir}/private-key.pem`;
    await Deno.writeTextFile(this.pemPath, privateKeyPem);

    // Generate self-signed TLS certs for the proxy
    this.logger.info("Generating self-signed TLS certs for proxy...");
    const certPath = `${tempDir}/cert.pem`;
    const tlsKeyPath = `${tempDir}/tls-key.pem`;
    await this.generateTlsCerts(certPath, tlsKeyPath);

    // Spawn tesla-http-proxy
    try {
      const cmd = new Deno.Command(this.binaryPath, {
        args: [
          "-key-file",
          this.pemPath,
          "-cert",
          certPath,
          "-tls-key",
          tlsKeyPath,
          "-host",
          "0.0.0.0",
          "-port",
          String(this.port),
          "-timeout",
          "30s",
        ],
        stdout: "piped",
        stderr: "piped",
      });

      this.process = cmd.spawn();
      this.logger.info(
        `Tesla HTTP proxy started on port ${this.port} (PID ${this.process.pid})`,
      );

      // Log proxy output in background
      this.pipeOutput(this.process);

      // Monitor for unexpected exit
      this.process.status.then((status: Deno.CommandStatus) => {
        this.logger.warn(
          `Tesla HTTP proxy exited with code ${status.code}`,
        );
        this.process = null;
      });

      return true;
    } catch (err) {
      // tesla-http-proxy binary not found (dev environment without Docker)
      if (err instanceof Deno.errors.NotFound) {
        this.logger.warn(
          `tesla-http-proxy binary not found at "${this.binaryPath}", skipping proxy start`,
        );
      } else {
        this.logger.error(
          `Failed to start Tesla HTTP proxy: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      await this.cleanupTempFiles();
      return false;
    }
  }

  /** Stop the proxy process and clean up temp files. */
  async stop(): Promise<void> {
    if (this.process) {
      try {
        this.process.kill("SIGTERM");
        await this.process.status;
      } catch (error) {
        // Process already exited
        this.logger.debug(`Process already exited: ${error}`);
      }
      this.process = null;
      this.logger.info("Tesla HTTP proxy stopped");
    }
    await this.cleanupTempFiles();
  }

  /** Restart the proxy (e.g. after key regeneration). */
  async restart(): Promise<boolean> {
    this.logger.info("Restarting Tesla HTTP proxy...");
    await this.stop();
    return await this.start();
  }

  private async generateTlsCerts(
    certPath: string,
    keyPath: string,
  ): Promise<void> {
    const cmd = new Deno.Command("openssl", {
      args: [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:secp521r1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "365",
        "-subj",
        "/CN=localhost",
      ],
      stdout: "null",
      stderr: "null",
    });
    const result = await cmd.output();
    if (!result.success) {
      throw new Error("Failed to generate TLS certificates for Tesla proxy");
    }
  }

  private async pipeOutput(process: Deno.ChildProcess): Promise<void> {
    const decoder = new TextDecoder();

    // Pipe stderr (tesla-http-proxy logs to stderr)
    try {
      await process.stderr.pipeTo(
        new WritableStream({
          write: (chunk) => {
            const text = decoder.decode(chunk).trim();
            if (text) this.logger.info(`[tesla-proxy] ${text}`);
          },
        }),
      );
    } catch (error) {
      // Process exited
      this.logger.debug(`Proxy stderr pipe ended: ${error}`);
    }
  }

  private async cleanupTempFiles(): Promise<void> {
    if (this.pemPath) {
      try {
        const dir = this.pemPath.replace(/\/[^/]+$/, "");
        await Deno.remove(dir, { recursive: true });
      } catch (error) {
        // Already cleaned up
        this.logger.debug(`Temp file cleanup skipped: ${error}`);
      }
      this.pemPath = null;
    }
  }
}
