/// <reference lib="deno.ns" />
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "[DEBUG]",
  info: "[INFO ]",
  warn: "[WARN ]",
  error: "[ERROR]",
};

function formatTimestamp(): string {
  const now = new Date();
  const Y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return "info";
  const lower = value.toLowerCase();
  if (lower in LOG_LEVELS) return lower as LogLevel;
  return "info";
}

/** Check whether a raw string is a valid log level (case-insensitive). */
export function isValidLogLevel(value: string): boolean {
  return value.toLowerCase() in LOG_LEVELS;
}

export class Logger {
  private readonly context: string;
  private readonly minLevel: number;

  constructor(context: string, level: LogLevel = "info") {
    this.context = context;
    this.minLevel = LOG_LEVELS[level];
  }

  debug(message: string, ...args: unknown[]): void {
    this._log("debug", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this._log("info", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this._log("warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this._log("error", message, args);
  }

  private _log(level: LogLevel, message: string, args: unknown[]): void {
    if (LOG_LEVELS[level] < this.minLevel) return;
    const prefix = `${formatTimestamp()} ${
      LEVEL_LABELS[level]
    } [${this.context}]`;
    if (args.length > 0) {
      console.log(prefix, message, ...args);
    } else {
      console.log(prefix, message);
    }
  }
}

/** Create a Logger that reads LOG_LEVEL from the environment once at call time. */
export function createLogger(context: string): Logger {
  const level = parseLogLevel(Deno.env.get("LOG_LEVEL"));
  return new Logger(context, level);
}
