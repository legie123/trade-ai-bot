// ============================================================
// Structured Logger — JSON-formatted, leveled, context-tagged
// Replaces console.log across the entire engine
// ============================================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  data?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4,
};

// Min log level from env (default INFO)
function getMinLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
  return LEVEL_PRIORITY[env as LogLevel] !== undefined ? (env as LogLevel) : 'INFO';
}

// ─── In-memory log buffer for dashboard ─────────────
const gLog = globalThis as unknown as { __logBuffer?: LogEntry[] };
if (!gLog.__logBuffer) gLog.__logBuffer = [];
const MAX_BUFFER = 500;

export function getRecentLogs(limit = 50): LogEntry[] {
  return (gLog.__logBuffer || []).slice(-limit);
}

export function getLogsByLevel(level: LogLevel, limit = 50): LogEntry[] {
  return (gLog.__logBuffer || [])
    .filter(e => LEVEL_PRIORITY[e.level] >= LEVEL_PRIORITY[level])
    .slice(-limit);
}

// ─── Core log function ──────────────────────────────
function log(level: LogLevel, module: string, msg: string, data?: Record<string, unknown>): void {
  const minLevel = getMinLevel();
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };

  // Buffer for dashboard
  gLog.__logBuffer!.push(entry);
  if (gLog.__logBuffer!.length > MAX_BUFFER) {
    gLog.__logBuffer = gLog.__logBuffer!.slice(-MAX_BUFFER);
  }

  // Console output
  const prefix = `[${entry.ts}] [${level}] [${module}]`;
  const suffix = data ? ` ${JSON.stringify(data)}` : '';

  switch (level) {
    case 'DEBUG': console.debug(`${prefix} ${msg}${suffix}`); break;
    case 'INFO':  console.log(`${prefix} ${msg}${suffix}`); break;
    case 'WARN':  console.warn(`${prefix} ${msg}${suffix}`); break;
    case 'ERROR': console.error(`${prefix} ${msg}${suffix}`); break;
    case 'FATAL': console.error(`🔴 ${prefix} ${msg}${suffix}`); break;
  }
}

// ─── Module-scoped logger factory ───────────────────
export interface Logger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info:  (msg: string, data?: Record<string, unknown>) => void;
  warn:  (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  fatal: (msg: string, data?: Record<string, unknown>) => void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, data) => log('DEBUG', module, msg, data),
    info:  (msg, data) => log('INFO',  module, msg, data),
    warn:  (msg, data) => log('WARN',  module, msg, data),
    error: (msg, data) => log('ERROR', module, msg, data),
    fatal: (msg, data) => log('FATAL', module, msg, data),
  };
}
