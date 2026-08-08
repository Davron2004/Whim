/**
 * Reads back what the server's `pino` logger emitted, in process (obs-v1).
 *
 * The root logger writes structured JSON to `process.stdout` (`server/test/run.mjs` sets
 * `WHIM_LOG_JSON=1`, which also disables the pretty transport's worker thread), so capturing is a
 * matter of intercepting `process.stdout.write`. Lines that parse as JSON are collected as log
 * records; everything else — the harness's own `check`/`section` output — is forwarded to the real
 * stdout, so a suite under capture still prints its results.
 */

export interface LogCapture {
  /** Every JSON line the logger emitted while capturing, in order. */
  readonly records: Record<string, unknown>[];
  /** Every captured line, verbatim — for "the value appears nowhere in the output" assertions. */
  readonly raw: string[];
  stop(): void;
}

type WriteFn = typeof process.stdout.write;

export function captureLogs(): LogCapture {
  const records: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout) as WriteFn;

  const write: WriteFn = ((chunk: unknown, ...rest: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    let captured = false;
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch (err: unknown) {
        // A parse failure means "not a log line" (harness output, or a partial write): leave the
        // text for the real stdout. Any other throw is not ours to swallow.
        if (!(err instanceof SyntaxError)) throw err;
        continue;
      }
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>);
        raw.push(line);
        captured = true;
      }
    }
    if (captured) return true;
    return (realWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as WriteFn;

  process.stdout.write = write;
  return {
    records,
    raw,
    stop(): void {
      process.stdout.write = realWrite;
    },
  };
}

/** Records whose `msg` matches — pino's message key. */
export function withMessage(capture: LogCapture, message: string): Record<string, unknown>[] {
  return capture.records.filter((r) => r.msg === message);
}
