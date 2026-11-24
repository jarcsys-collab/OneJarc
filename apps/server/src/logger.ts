/**
 * Tiny JSON-lines logger. One object per line on stdout (stderr for errors).
 * Never pass cookies, tokens, secrets or request bodies to it.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export function isLogLevel(value: string): value is LogLevel {
  return value in ORDER;
}

export function createLogger(level: LogLevel = "info", sink?: (line: string, level: LogLevel) => void): Logger {
  const min = ORDER[level];
  const write =
    sink ??
    ((line: string, lvl: LogLevel) => {
      if (lvl === "error") process.stderr.write(line + "\n");
      else process.stdout.write(line + "\n");
    });
  const log = (lvl: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields) => {
    if (ORDER[lvl] < min) return;
    let line: string;
    try {
      line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields });
    } catch {
      line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg });
    }
    write(line, lvl);
  };
  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
  };
}

export const silentLogger: Logger = createLogger("silent");

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
