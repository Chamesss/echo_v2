/**
 * Structured logging facade.
 *
 * Used by every layer instead of `console.log`. Keeping a single facade lets
 * us swap the implementation (e.g. to pino) later without touching callers.
 *
 * Output format is environment-aware:
 *   - production            → one JSON line per entry, for ingestion by log
 *                             pipelines (stable, machine-parseable).
 *   - everything else (dev) → a compact, colorized, human-readable line so the
 *                             terminal stays scannable during local work.
 *
 * Set `NO_COLOR=1` to strip ANSI colors from the dev format (honors the
 * https://no-color.org convention — useful when piping dev logs to a file).
 *
 * Call sites: `server.ts` for lifecycle events, `error-handler.ts` for
 * unexpected errors, and any service that needs to emit observability data.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const isProduction = process.env.NODE_ENV === 'production';
const useColor = !isProduction && !process.env.NO_COLOR;

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
} as const;

const LEVEL_COLOR: Record<Level, string> = {
  debug: ANSI.gray,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
};

function paint(color: string, text: string): string {
  return useColor ? `${color}${text}${ANSI.reset}` : text;
}

/**
 * Render an entry as `HH:MM:SS LEVEL message  key=value …`, with the timestamp
 * and trailing fields dimmed and the level coloured by severity.
 */
function pretty(level: Level, entry: Record<string, unknown>): string {
  const { time, message, level: _level, ...rest } = entry;
  const clock = typeof time === 'string' ? time.slice(11, 19) : '';

  const parts = [paint(ANSI.dim, clock), paint(LEVEL_COLOR[level], level.toUpperCase().padEnd(5))];
  if (message != null && message !== '') parts.push(String(message));

  let line = parts.join(' ');
  const extras = Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  if (extras) line += '  ' + paint(ANSI.dim, extras);
  return line;
}

function emit(level: Level, payload: unknown, message?: string): void {
  const body =
    typeof payload === 'string'
      ? { message: payload }
      : { ...(payload as Record<string, unknown>), ...(message ? { message } : {}) };

  const entry = { level, time: new Date().toISOString(), ...body };
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(isProduction ? JSON.stringify(entry) : pretty(level, entry));
}

export const logger = {
  debug: (payload: unknown, message?: string) => emit('debug', payload, message),
  info: (payload: unknown, message?: string) => emit('info', payload, message),
  warn: (payload: unknown, message?: string) => emit('warn', payload, message),
  error: (payload: unknown, message?: string) => emit('error', payload, message),
};
