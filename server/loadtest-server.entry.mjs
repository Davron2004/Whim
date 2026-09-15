/**
 * The load-test server process entry (design D26): `runLoadtestServer` with the process
 * environment, plus the two things only a process entry may own — the signal handlers and
 * `process.exit`. Mirrors `server/src/main.ts` field for field; the only difference is which
 * composition it starts. Bundled by `server/loadtest-build.mjs` into
 * `server/dist/loadtest/server/loadtest-server.mjs`, the load-test image's `CMD`.
 */
import { runLoadtestServer } from './src/loadtest/server';
import { startServer } from './src/lifecycle';
import { log } from './src/logger';

function exitAfterFlush(code) {
  process.stdout.write('', () => process.exit(code));
}

const handle = await runLoadtestServer({ env: process.env, start: startServer }).catch((err) => {
  // Structural, not `instanceof`: this can be `lifecycle.ts`'s `BootError` (a failure inside the
  // real `startServer`) or `server/src/loadtest/server.ts`'s own `LoadtestConfigError` (the
  // pre-start refusal) — both carry a `reason` field, and this entry never imports the latter
  // class just to narrow on it.
  const reason = err && typeof err === 'object' && 'reason' in err ? err.reason : 'unexpected';
  log.fatal({ reason, detail: err instanceof Error ? err.message : String(err) }, 'boot failed');
  exitAfterFlush(1);
  return undefined;
});

if (handle) {
  let draining = false;
  const onSignal = (signal) => {
    if (draining) {
      log.warn({ signal }, 'second shutdown signal: skipping the drain wait');
      handle.drain();
      return;
    }
    draining = true;
    log.info({ signal }, 'shutdown signal: draining');
    handle.drain().then(() => exitAfterFlush(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
