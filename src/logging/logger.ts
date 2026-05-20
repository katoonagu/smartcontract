export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type LogRecord = {
  level: LogLevel;
  event: string;
  timestamp: string;
} & LogFields;

export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

export type LoggerOptions = {
  now?: () => Date;
  sink?: (record: LogRecord) => void;
};

function defaultSink(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === "error") {
    console.error(line);
    return;
  }
  if (record.level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? defaultSink;

  function write(level: LogLevel, event: string, fields: LogFields = {}): void {
    sink({
      level,
      event,
      timestamp: now().toISOString(),
      ...fields
    });
  }

  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields)
  };
}

export const logger = createLogger();
