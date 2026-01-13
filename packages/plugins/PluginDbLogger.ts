import type { Logger } from "@chargeha/server/lib/Logger";

/**
 * Callback signature for persisting a log entry.
 * Provided by createPluginDependencies — plugins never import AppDatabase.
 */
export type PersistLogFn = (entry: {
  level: string;
  message: string;
  payload: string | null;
  origin: string | null;
  traceId: string | null;
}) => Promise<void>;

interface LogOpts {
  payload?: Record<string, unknown>;
  origin?: string;
  traceId?: string;
}

/**
 * Structured database logger injected into plugins via PluginDependencies.
 * Persists log entries through a callback so plugins stay decoupled from the DB.
 * Persist failures are caught internally and logged via the injected Logger.
 */
export class PluginDbLogger {
  private readonly persist: PersistLogFn;
  private readonly logger: Logger;

  constructor(persist: PersistLogFn, logger: Logger) {
    this.persist = persist;
    this.logger = logger;
  }

  async log(level: string, message: string, opts?: LogOpts): Promise<void> {
    const entry = {
      level,
      message,
      payload: opts?.payload ? JSON.stringify(opts.payload) : null,
      origin: opts?.origin ?? null,
      traceId: opts?.traceId ?? null,
    };
    try {
      await this.persist(entry);
    } catch (error) {
      this.logger.error("Failed to persist log entry:", error, entry);
    }
  }

  async info(message: string, opts?: LogOpts): Promise<void> {
    await this.log("info", message, opts);
  }

  async warn(message: string, opts?: LogOpts): Promise<void> {
    await this.log("warn", message, opts);
  }

  async error(message: string, opts?: LogOpts): Promise<void> {
    await this.log("error", message, opts);
  }

  async debug(message: string, opts?: LogOpts): Promise<void> {
    await this.log("debug", message, opts);
  }
}
