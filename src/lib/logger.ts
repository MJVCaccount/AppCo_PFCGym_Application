import "server-only";

/**
 * Server-side logger: one JSON object per line, so a log drain can parse it.
 *
 * This is the only file allowed to write to process.stdout / process.stderr.
 * Anything that looks like a credential is redacted before it is written, and
 * request bodies are dropped whole — log the fields you need, by name.
 */

type Level = "info" | "warn" | "error";

export type LogMeta = Record<string, unknown>;

const SENSITIVE_KEY =
  /password|passwd|hash|salt|token|secret|authori[sz]ation|cookie|^body$/i;
const REDACTED = "[redacted]";
const MAX_DEPTH = 4;

function sanitise(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return {
      name: value.name,
      message: value.message,
      ...(typeof code === "string" ? { code } : {}),
      stack: value.stack,
    };
  }

  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    return value.map((item) => sanitise(item, depth + 1));
  }

  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clean[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitise(item, depth + 1);
  }
  return clean;
}

function write(level: Level, message: string, meta?: LogMeta): void {
  let line: string;

  try {
    line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...(meta ? { meta: sanitise(meta) } : {}),
    });
  } catch {
    // Circular or otherwise unserialisable meta must never break a request.
    line = JSON.stringify({ level, time: new Date().toISOString(), message });
  }

  const stream = level === "info" ? process.stdout : process.stderr;
  stream.write(line + "\n");
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    write("info", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    write("warn", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    write("error", message, meta);
  },
};
