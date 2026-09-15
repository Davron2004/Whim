/**
 * The server process entry: `startServer` (`lifecycle.ts`) with the process environment and no
 * overrides, plus the two things only a process entry may own — the signal handlers and
 * `process.exit`. Runs as `node server/main.mjs` from the runtime tree (`server/build.mjs`), or
 * bundled by `server/dev.mjs` in dev.
 *
 * Boot failure logs the step and the named item, then exits 1. The first SIGTERM or SIGINT starts
 * the drain and exits 0 when it completes; a second signal skips the drain's wait.
 */
import { BootError, startServer } from './lifecycle';
import { log } from './logger';

/** Exits once everything already written to stdout has been flushed, so the last log line lands. */
function exitAfterFlush(code: number): void {
  process.stdout.write('', () => process.exit(code));
}

const handle = await startServer({ env: process.env }).catch((err: unknown) => {
  const reason = err instanceof BootError ? err.reason : 'unexpected';
  log.fatal({ reason, detail: err instanceof Error ? err.message : String(err) }, 'boot failed');
  exitAfterFlush(1);
  return undefined;
});

if (handle) {
  let draining = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (draining) {
      log.warn({ signal }, 'second shutdown signal: skipping the drain wait');
      handle.drain();
      return;
    }
    draining = true;
    log.info({ signal }, 'shutdown signal: draining');
    // The drain never rejects (`ServerHandle.drain`), and it has closed the listener, the browser
    // and the stores by the time it resolves.
    handle.drain().then(() => exitAfterFlush(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
