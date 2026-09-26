/**
 * Minimal logger interface shared by main, renderer and worker code so pure
 * modules and services can be tested with a fake instead of electron-log.
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const NULL_LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Normalise any thrown value to a message + optional stack. */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return err.stack ? { message: err.message, stack: err.stack } : { message: err.message };
  }
  if (typeof err === 'string') return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}
