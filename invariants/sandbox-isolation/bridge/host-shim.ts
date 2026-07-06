/**
 * capability-bridge invariant suite — the Node HOST SHIM (Decision #41, D8).
 *
 * The browser scenario pages run the REAL sandbox (Chromium enforces the #35 CSP + the iframe)
 * delivering a REAL hostile bundle over the REAL syscall transport; this shim is the host end
 * of that pipe — the SAME gate/dispatcher/registry modules the RN host uses, over a REAL
 * `node:sqlite` `:memory:` engine. It is exposed to the page via Playwright's `exposeFunction`,
 * so a syscall the bundle makes travels iframe → relay → `whimHostDispatch` (here) → engine and
 * back. The only thing simulated is "RN host" → "Node host"; the design's authoritative run is
 * still on-device (D8).
 *
 * `npm run bridge:invariants` esbuild-bundles this to a temp ESM and imports it (the storage
 * runner idiom), then drives the pages.
 */

import { createEngine } from '../../../src/host/storage-engine/engine';
import { createNodeSqlExecutor } from '../../../src/host/storage-engine/bindings/node-sqlite';
import {
  AppRecord,
  CapabilityRegistry,
  createDefaultRegistry,
  Dispatcher,
  launchApp,
  RealmRecord,
  resetRealmGeneration,
} from '../../../src/host/bridge';

export interface Host {
  realm: RealmRecord;
  /** The exposed dispatch: a frame string in, a sysret string (or null when dropped) out. */
  dispatch: (frameString: string) => Promise<string | null>;
  /** Bump the realm generation (a realm reset) — fresh dispatcher, fresh dedup + id space. */
  bumpGeneration: () => void;
}

/** Build a host over one app record. `manifestOverride` lets the negative control deliberately
 *  MISCONFIGURE the gate (grant a capability the bundle never declared). */
export function makeHost(app: AppRecord, manifestOverride?: string[]): Host {
  const registry: CapabilityRegistry = createDefaultRegistry();
  const effective: AppRecord = manifestOverride
    ? { ...app, manifest: { capabilities: manifestOverride }, schemaArtifact: app.schemaArtifact ?? defaultSchema() }
    : app;

  const launched = launchApp(effective, () => createEngine(createNodeSqlExecutor(':memory:')));
  if (!launched.ok) throw new Error('host shim launch refused: ' + launched.error.hint);
  const realm = launched.realm;
  let dispatcher = Dispatcher.forRealm(realm, registry);

  return {
    realm,
    dispatch: async (frameString: string): Promise<string | null> => {
      const sysret = await dispatcher.handle(frameString);
      return sysret ? JSON.stringify(sysret) : null;
    },
    bumpGeneration: (): void => {
      resetRealmGeneration(realm);
      dispatcher = Dispatcher.forRealm(realm, registry); // new generation → empty dedup, fresh id space
    },
  };
}

/** A minimal schema so a misconfigured (manifest-override) host still has a store to open. */
function defaultSchema() {
  return {
    schemaVersion: 1 as const,
    collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' as const } } } },
  };
}
