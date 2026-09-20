/**
 * server/test/e2e-drain-server.ts — a real server process for `e2e.ts`'s real-pipeline SIGTERM case.
 * It runs the production composition (`startServer`, real synthetic-run session and boot self-test)
 * with the scripted held-run generation instead of a live model, and wires SIGTERM/SIGINT to the
 * drain the way `main.ts` does. Never imported: `e2e.ts` bundles it and spawns it from the repo root.
 *
 * It reports on stdout as `{"e2eServer":{…}}` lines: its URL and its browser's process id once
 * listening, every change in the session's open browser contexts, and `drained` before it exits 0.
 */
import { startServer } from '../src/lifecycle';
import { E2E_ROSTER, heldRunTurns } from './e2e-fixtures';
import { ScriptedModelClient } from './scripted-model';

function emit(fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ e2eServer: fields })}\n`);
}

const handle = await startServer({
  env: process.env,
  overrides: { model: { client: new ScriptedModelClient(E2E_ROSTER, heldRunTurns()), roster: E2E_ROSTER } },
  listen: { host: '127.0.0.1', port: 0 },
});
const session = handle.session;
if (!session) throw new Error('e2e-drain-server: the real pipeline started without a synthetic-run session');
emit({ url: handle.url, browserPid: await session.browserProcessId() });

let contexts = session.openContextCount();
setInterval(() => {
  const now = session.openContextCount();
  if (now === contexts) return;
  contexts = now;
  emit({ contexts });
}, 25).unref();

let draining = false;
const onSignal = (): void => {
  if (draining) {
    handle.drain();
    return;
  }
  draining = true;
  handle.drain().then(() => {
    emit({ drained: true, contexts: session.openContextCount() });
    process.stdout.write('', () => process.exit(0));
  });
};
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
