/**
 * Firestore conformance entry for the server stores (durable-server-stores, design D5). Run only
 * through `npm run stores:firestore:test`, which starts the Firestore emulator via a pinned
 * firebase-tools and sets FIRESTORE_EMULATOR_HOST before invoking this file.
 *
 * Bootstrap: no Firestore store exists yet, so it registers zero conformance cases. It does prove
 * the client reaches the emulator (one write, read back) so the store chains start from a working
 * connection. The Firestore chains replace the body with the shared store-conformance cases.
 *
 *   npm run stores:firestore:test
 */

import { Firestore } from '@google-cloud/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('stores:firestore:test FAILED — FIRESTORE_EMULATOR_HOST is unset; run via the npm script.');
  process.exit(1);
}

// The client retries an unreachable emulator indefinitely; fail by name instead of hanging the gate.
const watchdog = setTimeout(() => {
  console.error('stores:firestore:test FAILED — emulator round-trip did not finish within 30s.');
  process.exit(1);
}, 30_000);

const db = new Firestore({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-whim-conformance' });
const ref = db.collection('_bootstrap').doc(`probe-${process.pid}`);
const written = Date.now();
await ref.set({ written });
const read = (await ref.get()).get('written');
await db.terminate();
clearTimeout(watchdog);

if (read !== written) {
  console.error(`stores:firestore:test FAILED — emulator round-trip returned ${String(read)}, expected ${written}.`);
  process.exit(1);
}

console.log(`firestore conformance: 0 cases; emulator round-trip OK (${process.env.FIRESTORE_EMULATOR_HOST})`);
