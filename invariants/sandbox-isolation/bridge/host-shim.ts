/**
 * capability-bridge invariant suite — the Node HOST SHIM (Decision #41, D8).
 *
 * The browser scenario pages run the REAL sandbox (Chromium enforces the #35 CSP + the iframe)
 * delivering a REAL hostile bundle over the REAL syscall transport; this shim is the host end
 * of that pipe — the SAME gate/dispatcher/registry modules the RN host uses, over a REAL
 * `node:sqlite` `:memory:` engine. It is exposed to the page via Playwright's `exposeBinding`,
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
  CueBackend,
  createDefaultRegistry,
  Dispatcher,
  HapticKind,
  launchApp,
  RealmRecord,
  resetRealmGeneration,
  SoundName,
} from '../../../src/host/bridge';

/** A recording-fake CueBackend (effects-and-cues INV-CUEGATE): it logs every cue it is asked to
 *  perform but produces no device effect. The cue-gate invariant asserts this log stays EMPTY when
 *  a hostile bundle is denied — a fired cue would mean the gate let an attack through. */
export interface RecordingCueBackend extends CueBackend {
  readonly log: string[];
}
export function recordingCueBackend(): RecordingCueBackend {
  const log: string[] = [];
  return {
    log,
    haptic(kind: HapticKind): void { log.push('haptic:' + kind); },
    sound(name: SoundName): void { log.push('sound:' + name); },
  };
}

export interface Host {
  realm: RealmRecord;
  /** The exposed dispatch: a frame string in, a sysret string (or null when dropped) out. */
  dispatch: (frameString: string) => Promise<string | null>;
  /** Bump the realm generation (a realm reset) — fresh dispatcher, fresh dedup + id space. */
  bumpGeneration: () => void;
  /** The recording cue backend wired into this host's registry (INV-CUEGATE asserts log==[]). */
  cueLog: string[];
  /** Every sysret this host answered, parsed — the host-side record the checks judge by, instead of
   *  the bundle's own rendered text (a bundle can print anything). */
  sysrets: { method?: string; ok: boolean; error?: { kind?: string } }[];
  /** The user tables in the app's SQLite database, read from `sqlite_master` on the host side. */
  tables: () => string[];
}

/** Build a host over one app record. `manifestOverride` lets the negative control deliberately
 *  MISCONFIGURE the gate (grant a capability the bundle never declared). A recording-fake cue
 *  backend is always wired in so the cue-gate invariant can assert ZERO device invocations. */
export function makeHost(app: AppRecord, manifestOverride?: string[]): Host {
  const cueBackend = recordingCueBackend();
  const registry: CapabilityRegistry = createDefaultRegistry({ cueBackend });
  const effective: AppRecord = manifestOverride
    ? { ...app, manifest: { capabilities: manifestOverride }, schemaArtifact: app.schemaArtifact ?? defaultSchema() }
    : app;

  const executor = createNodeSqlExecutor(':memory:');
  const launched = launchApp(effective, () => createEngine(executor));
  if (!launched.ok) throw new Error('host shim launch refused: ' + launched.error.hint);
  const realm = launched.realm;
  let dispatcher = Dispatcher.forRealm(realm, registry);
  const sysrets: Host['sysrets'] = [];

  return {
    realm,
    dispatch: async (frameString: string): Promise<string | null> => {
      const sysret = await dispatcher.handle(frameString);
      if (sysret) sysrets.push({ method: methodOf(frameString), ok: sysret.ok, error: sysret.ok ? undefined : sysret.error });
      return sysret ? JSON.stringify(sysret) : null;
    },
    bumpGeneration: (): void => {
      resetRealmGeneration(realm);
      dispatcher = Dispatcher.forRealm(realm, registry); // new generation → empty dedup, fresh id space
    },
    cueLog: cueBackend.log,
    sysrets,
    tables: () =>
      executor
        .execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .rows.map((row) => String(row.name)),
  };
}

function methodOf(frameString: string): string | undefined {
  try {
    const frame = JSON.parse(frameString) as { method?: unknown };
    return typeof frame.method === 'string' ? frame.method : undefined;
  } catch {
    return undefined;
  }
}

/** A minimal schema so a misconfigured (manifest-override) host still has a store to open. */
function defaultSchema() {
  return {
    schemaVersion: 1 as const,
    collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' as const } } } },
  };
}
