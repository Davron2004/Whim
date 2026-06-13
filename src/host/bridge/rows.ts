/**
 * capability-bridge — the capability rows (Decision #41, D5). Storage is syscall #1; `diag` is
 * the "second capability" thought-experiment that proves the registry shape (a new capability
 * is one row + one stub, with zero transport/dispatcher edits) and doubles as the round-trip
 * latency echo (D8 / task 6.3).
 *
 * Each row is a few lines on purpose: a thin binding onto the realm record's engine handle,
 * deriving everything from `(params, realm)`. The engine throws structured StorageEngineErrors
 * for bad identifiers/values; the dispatcher surfaces those verbatim, so the end-to-end
 * injection property holds without any per-verb defending here.
 */

import {
  CueBackend,
  HAPTIC_KINDS,
  HapticKind,
  JsonValue,
  ListQuery,
  ParamsValidator,
  RealmRecord,
  RegistryRow,
  SOUND_NAMES,
  SoundName,
} from './contract';
import { CapabilityRegistry } from './registry';
import { storageError } from '../storage-engine/contract';

// ── tiny params validators (the marshal.ts `checkValue` idiom: null = ok, string = reason) ──

const isObject = (v: unknown): v is Record<string, JsonValue> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function requireString(params: Record<string, unknown>, key: string): string | null {
  return typeof params[key] === 'string' ? null : `"${key}" must be a string`;
}
function requireRecordId(params: Record<string, unknown>): string | null {
  return typeof params.id === 'number' && Number.isInteger(params.id) ? null : '"id" must be an integer';
}
function requireFieldMap(params: Record<string, unknown>, key: string): string | null {
  return isObject(params[key]) ? null : `"${key}" must be an object of field values`;
}

const vGet: ParamsValidator = (p) => (isObject(p) ? requireString(p, 'key') : 'params must be an object');
const vSet: ParamsValidator = (p) => {
  if (!isObject(p)) return 'params must be an object';
  const k = requireString(p, 'key');
  if (k) return k;
  return 'value' in p ? null : '"value" is required';
};
const vRemoveKey: ParamsValidator = vGet;

const vAppend: ParamsValidator = (p) => {
  if (!isObject(p)) return 'params must be an object';
  return requireString(p, 'collection') || requireFieldMap(p, 'record');
};
const vList: ParamsValidator = (p) => {
  if (!isObject(p)) return 'params must be an object';
  const c = requireString(p, 'collection');
  if (c) return c;
  if ('query' in p && p.query !== undefined && !isObject(p.query)) return '"query" must be an object';
  return null;
};
const vUpdate: ParamsValidator = (p) => {
  if (!isObject(p)) return 'params must be an object';
  return requireString(p, 'collection') || requireRecordId(p) || requireFieldMap(p, 'patch');
};
const vRemoveRecord: ParamsValidator = (p) => {
  if (!isObject(p)) return 'params must be an object';
  return requireString(p, 'collection') || requireRecordId(p);
};

// ── the engine-handle accessor — a missing engine is a structured, non-leaky error ──

function engineOf(realm: RealmRecord) {
  if (!realm.engine) {
    throw storageError({
      kind: 'not_open',
      hint: 'This app has no storage engine open; declare the storage capability and a schema in defineApp.',
    });
  }
  return realm.engine;
}

// ── rows ──────────────────────────────────────────────────────────────────────

const STORAGE_ROWS: Record<string, RegistryRow> = {
  'storage.kv.get': {
    capability: 'storage',
    paramsSchema: vGet,
    handler: (p, realm) => {
      const v = engineOf(realm).kv.get(p.key as string);
      return v === undefined ? { found: false, value: null } : { found: true, value: v };
    },
  },
  'storage.kv.set': {
    capability: 'storage',
    paramsSchema: vSet,
    handler: (p, realm) => {
      engineOf(realm).kv.set(p.key as string, (p as { value: JsonValue }).value);
      return {};
    },
  },
  'storage.kv.remove': {
    capability: 'storage',
    paramsSchema: vRemoveKey,
    handler: (p, realm) => {
      engineOf(realm).kv.remove(p.key as string);
      return {};
    },
  },
  'storage.records.append': {
    capability: 'storage',
    paramsSchema: vAppend,
    handler: (p, realm) =>
      engineOf(realm).records.append(p.collection as string, p.record as Record<string, JsonValue>),
  },
  'storage.records.list': {
    capability: 'storage',
    paramsSchema: vList,
    handler: (p, realm) => ({
      records: engineOf(realm).records.list(p.collection as string, p.query as ListQuery | undefined),
    }),
  },
  'storage.records.update': {
    capability: 'storage',
    paramsSchema: vUpdate,
    handler: (p, realm) => {
      engineOf(realm).records.update(p.collection as string, p.id as number, p.patch as Record<string, JsonValue>);
      return {};
    },
  },
  'storage.records.remove': {
    capability: 'storage',
    paramsSchema: vRemoveRecord,
    handler: (p, realm) => {
      engineOf(realm).records.remove(p.collection as string, p.id as number);
      return {};
    },
  },
};

/** Register the storage rows (syscall #1). Each is a thin binding onto realm.engine. */
export function registerStorageRows(registry: CapabilityRegistry): void {
  for (const [method, row] of Object.entries(STORAGE_ROWS)) registry.register(method, row);
}

/**
 * Register `diag` — the "second capability" proof (one row, one stub, no transport/dispatcher
 * change) and the round-trip latency echo. `diag.echo` returns its `payload` plus a host
 * timestamp; it touches no engine, deriving everything from its arguments (D5).
 */
export function registerDiagRows(registry: CapabilityRegistry): void {
  registry.register('diag.echo', {
    capability: 'diag',
    paramsSchema: (p) => (isObject(p) ? null : 'params must be an object'),
    handler: (p) => ({ echo: (p as { payload?: JsonValue }).payload ?? null }),
  });
}

// ── cue rows (effects-and-cues D5/D7) — syscall #2/#3 ───────────────────────────
// The append-only readiness test (#41): haptics + sound land as exactly two rows + their two
// SDK stubs, with ZERO transport/dispatcher edits. Each row is a thin binding onto the injected
// `CueBackend` (D5) — it touches no realm engine, derives everything from `(params, backend)`.
// Off-set tokens are rejected with a hint that ENUMERATES the closed set straight from the
// contract's token arrays (D4 / §8.1 self-repair). Fire-and-forget (D7): the handler triggers
// the cue and returns `{}` immediately — completion/duration/device-state stay unobservable.

/** A closed-token validator whose reject reason lists the valid members (the §8.1 fix-hint). */
function vToken(key: string, set: readonly string[]): ParamsValidator {
  return (p) => {
    if (!isObject(p)) return 'params must be an object';
    return typeof p[key] === 'string' && set.includes(p[key] as string)
      ? null
      : `"${key}" must be one of: ${set.join(', ')}`;
  };
}

/** A missing backend is a STRUCTURED handler error (D5), never an unshaped throw the dispatcher
 *  can't shape: the generic `catch` turns this Error into a `handler_error` sysret with a hint,
 *  so a backend-less host (e.g. the gate-denial Node tests, or a future non-cue platform) still
 *  answers the bundle with a rejected promise rather than crashing. */
function cueBackendOf(backend: CueBackend | null | undefined): CueBackend {
  if (!backend) {
    throw new Error('cue backend unavailable on this host — no haptic/sound device is wired here');
  }
  return backend;
}

/**
 * Register the cue rows (syscall #2/#3) bound to an injected backend (D5). Called UNCONDITIONALLY
 * by `createDefaultRegistry` (even with `backend == null`) so gate denials stay testable with no
 * device wired; an actually-declared cue with no backend surfaces the structured handler error
 * above. The RN `Vibration`/ToneGenerator implementation is `src/host/cue-backend.ts` — never
 * imported here, so this module stays loadable under Node (the bridge suites).
 */
export function registerCueRows(registry: CapabilityRegistry, backend?: CueBackend | null): void {
  registry.register('cues.haptic', {
    capability: 'cues',
    paramsSchema: vToken('kind', HAPTIC_KINDS),
    handler: (p) => {
      cueBackendOf(backend).haptic(p.kind as HapticKind);
      return {};
    },
  });
  registry.register('cues.sound', {
    capability: 'cues',
    paramsSchema: vToken('name', SOUND_NAMES),
    handler: (p) => {
      cueBackendOf(backend).sound(p.name as SoundName);
      return {};
    },
  });
}
