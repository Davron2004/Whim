/**
 * `npm run stores:firestore:test`: runs `server/test/firestore.run.mjs` against a Firestore emulator
 * started by the repo's pinned firebase-tools, on ports picked free for this run. Given a script
 * (and its arguments), runs that instead: `deploy/loadtest/firestore-admission.sh` passes
 * `server/test/firestore-admission.run.mjs`.
 *
 * The emulator used to listen on fixed ports (8085, with the hub on 4400 and logging on 4500), so
 * two checkouts gating at once collided: the second run failed with "port taken" (#144). Each run
 * now writes its own firebase.json with ports the OS just handed out, and its own demo project id,
 * which the hub's locator file is keyed by. Another process can still take a port between the pick
 * and the emulator's bind, so a run that fails to start on a taken port is retried on new ports.
 *
 *   npm run stores:firestore:test
 *   node scripts/firestore-emulator-test.mjs <node script> [args...]
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebaseBin = fileURLToPath(import.meta.resolve('firebase-tools/lib/bin/firebase.js'));
const HOST = '127.0.0.1';
const ATTEMPTS = 3;
const PORT_TAKEN = /port taken|EADDRINUSE|address already in use/i;
const [scriptArg, ...scriptArgs] = process.argv.slice(2);
const scriptPath = scriptArg ? path.resolve(scriptArg) : path.join(root, 'server', 'test', 'firestore.run.mjs');

/** `word` single-quoted for the shell `emulators:exec` runs its script in. */
function shellQuote(word) {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** A port the OS reports free right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Distinct free ports for the emulator, its websocket, the hub and the logging emulator. */
async function freePorts() {
  const ports = new Set();
  while (ports.size < 4) ports.add(await freePort());
  const [firestore, websocket, hub, logging] = ports;
  return { firestore, websocket, hub, logging };
}

/** One `emulators:exec` run; resolves with its exit code and whether a port was taken. */
async function runOnce() {
  const ports = await freePorts();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-emulator-'));
  const config = path.join(dir, 'firebase.json');
  fs.writeFileSync(config, `${JSON.stringify({
    emulators: {
      firestore: { host: HOST, port: ports.firestore, websocketPort: ports.websocket },
      hub: { host: HOST, port: ports.hub },
      logging: { host: HOST, port: ports.logging },
      ui: { enabled: false },
      singleProjectMode: true,
    },
  }, null, 2)}\n`);
  const project = `demo-whim-conformance-${randomBytes(4).toString('hex')}`;
  const script = [process.execPath, scriptPath, ...scriptArgs].map(shellQuote).join(' ');
  console.log(`firestore emulator on ${HOST}:${ports.firestore} (hub ${ports.hub}, logging ${ports.logging}, websocket ${ports.websocket}), project ${project}`);
  let output = '';
  const child = spawn(process.execPath, [firebaseBin, 'emulators:exec', '--config', config, '--only', 'firestore', '--project', project, script], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    from.on('data', (chunk) => {
      output += chunk;
      to.write(chunk);
    });
  }
  const code = await new Promise((resolve) => child.once('close', (exitCode) => resolve(exitCode ?? 1)));
  fs.rmSync(dir, { recursive: true, force: true });
  // Only a start-up failure is retried: once the script runs, its own failures are the verdict.
  const started = output.includes('Running script');
  return { code, portTaken: !started && PORT_TAKEN.test(output) };
}

for (let attempt = 1; ; attempt++) {
  const { code, portTaken } = await runOnce();
  if (!portTaken || attempt === ATTEMPTS) process.exit(code);
  console.error(`stores:firestore:test: an emulator port was taken before it bound; retrying on new ports (${attempt}/${ATTEMPTS - 1}).`);
}
