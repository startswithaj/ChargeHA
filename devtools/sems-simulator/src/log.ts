import { LOG_LEVEL } from "./config.ts";

const RANK = { silent: 0, info: 1, debug: 2 } as const;
const rank = RANK[LOG_LEVEL];

const useColour = (() => {
  if (Deno.env.get("NO_COLOR")) return false;
  try {
    return Deno.stdout.isTerminal();
  } catch {
    return false;
  }
})();

const paint = (code: string, text: string): string =>
  useColour ? `\x1b[${code}m${text}\x1b[0m` : text;

export const colour = {
  dim: (t: string) => paint("2", t),
  bold: (t: string) => paint("1", t),
  red: (t: string) => paint("31", t),
  green: (t: string) => paint("32", t),
  yellow: (t: string) => paint("33", t),
  blue: (t: string) => paint("34", t),
  magenta: (t: string) => paint("35", t),
  cyan: (t: string) => paint("36", t),
};

const stamp = (): string => new Date().toISOString().slice(11, 23);

const TAG_WIDTH = 8;
const line = (
  tag: string,
  tint: (text: string) => string,
  message: string,
) =>
  console.log(
    `${colour.dim(stamp())} ${tint(tag.padEnd(TAG_WIDTH))} ${message}`,
  );

export const isDebug = rank >= RANK.debug;
export const isInfo = rank >= RANK.info;

export const info = (tag: string, message: string) => {
  if (rank < RANK.info) return;
  line(tag, colour.cyan, message);
};

export const warn = (tag: string, message: string) => {
  if (rank < RANK.info) return;
  line(tag, colour.yellow, message);
};

export const injected = (message: string) => {
  if (rank < RANK.info) return;
  line("INJECTED", colour.magenta, colour.magenta(message));
};

export const error = (tag: string, message: string) => {
  line(tag, colour.red, message);
};

export const debug = (tag: string, message: string) => {
  if (rank < RANK.debug) return;
  line(tag, colour.dim, colour.dim(message));
};

export const startup = (message: string) => console.log(message);

const SECRET_KEYS = new Set(["pwd", "password", "pass", "passwd"]);
const TOKEN_KEYS = new Set(["token", "authorization"]);

export const shortToken = (value: string): string =>
  value.length <= 8 ? `${value}…` : `${value.slice(0, 8)}…`;

export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const lower = key.toLowerCase();
        if (SECRET_KEYS.has(lower)) return [key, "***redacted***"];
        if (TOKEN_KEYS.has(lower) && typeof item === "string") {
          return [key, shortToken(item)];
        }
        return [key, redact(item)];
      }),
    );
  }
  return value;
};

export const redactedJson = (value: unknown): string => {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return "(unserialisable)";
  }
};
