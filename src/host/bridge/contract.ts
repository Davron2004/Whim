/**
 * capability-bridge — the syscall contract (Decision #41, D1/D4/D5).
 *
 * The protocol seam between a sandboxed mini-app bundle and host-side capabilities. It
 * declares the two-family frame model (control vs. syscall/sysret), the request/response
 * envelope, the structured gate-error shape, the append-only registry-row shape, and the
 * per-realm record the dispatcher closes over. It imports the storage engine's verb/param
 * types VERBATIM (the `mini-app-storage-engine` D8 inter-change seam) — the bridge never
 * re-declares the storage vocabulary, it consumes it.
 *
 * Keep this file dependency-free (types + tiny pure helpers only): the SDK facade, the host
 * dispatcher, and the Node test suite all import it, and the SDK bundle (browser) must not
 * pull in `node:sqlite`/op-sqlite. Storage types are imported `type`-only for that reason.
 */

import type {
  JsonValue,
  ListQuery,
  SchemaArtifact,
  StorageEngine,
  StorageError,
  StorageRecord,
} from '../storage-engine/contract';

export type { JsonValue, ListQuery, SchemaArtifact, StorageRecord, StorageError };

// ─────────────────────────────────────────────────────────────────────────────
// D1 — two frame families, classified by a single discriminator rule
// ─────────────────────────────────────────────────────────────────────────────
//
// All iframe↔host traffic is untrusted data (carry-forward constraint #4). Within it there
// are two DISJOINT families, and neither handler may ever interpret the other's frames:
//
//   • control — loader/runtime lifecycle + verdicts, authenticated by the per-realm nonce
//               (`__whimHarness`/`__whimHostInit`/`__whimDeliver`/`__whimUiEvent`). Unchanged
//               from v0.1; the bridge adds nothing to it.
//   • syscall / sysret — the new RPC envelope, keyed on the `whim` discriminator. Deliberately
//               NOT nonce-authenticated: the legitimate sender IS the untrusted bundle (via the
//               SDK stub), so there is no honest-sender property to authenticate — authority
//               comes entirely from the host-side gate (D4). What matters is family separation.
//
// `classifyFrame` is the SINGLE classifier (task 1.2): the host dispatcher, the SDK marshaller,
// and the outer-document relay all decide family by this same rule, so a bundle forging a
// control frame gains nothing new (F4 already covers it) and a forged in-iframe `sysret` is a
// no-op (the marshaller only accepts host-channel frames and only resolves ids it issued).

export const SYSCALL_VERSION = 1 as const;

export type FrameFamily = 'control' | 'syscall' | 'sysret' | 'unknown';

/** The one classifier shared across host + runtime sides (D1 / task 1.2). Mirrored verbatim
 *  in the plain-JS runtime parts (`src/runtime/web/syscall.js`, the outer-document relay in
 *  `build/assemble.mjs`) by the same discriminator keys — keep them in sync. */
export function classifyFrame(frame: unknown): FrameFamily {
  if (!frame || typeof frame !== 'object') return 'unknown';
  const f = frame as Record<string, unknown>;
  if (
    f.__whimHarness === true ||
    f.__whimHostInit === true ||
    f.__whimDeliver === true ||
    f.__whimUiEvent === true
  ) {
    return 'control';
  }
  if (f.whim === 'syscall') return 'syscall';
  if (f.whim === 'sysret') return 'sysret';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelopes (D1) — versioned, JSON-only, no app identifier (D2: identity is channel-derived)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A syscall request. There is NO app/store/realm field the bundle can set (D2) — the host
 * resolves the calling app from the channel the frame arrived on, never from message content.
 * Extra fields a hostile bundle bolts on (appId, path, …) are structurally ignored.
 */
export interface SyscallFrame {
  whim: 'syscall';
  v: typeof SYSCALL_VERSION;
  /** Correlation id, monotonic per realm generation (the stub's id space). */
  id: number;
  /** The marshaller's `__whimGeneration` at send time — the generation fence (D3). */
  gen: number;
  method: string;
  params: { [key: string]: JsonValue };
}

/** A syscall response. Flows host→iframe ONLY; the marshaller resolves the matching id. */
export interface SysretFrame {
  whim: 'sysret';
  v: typeof SYSCALL_VERSION;
  id: number;
  ok: boolean;
  result?: JsonValue;
  /** A gate denial (BridgeError) or an engine refusal (StorageError) — both carry kind+hint. */
  error?: BridgeError | StorageError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured gate errors (D4) — every denial is data, carrying a machine-actionable hint
// ─────────────────────────────────────────────────────────────────────────────

export type BridgeErrorKind =
  // — envelope / dispatch —
  | 'malformed_envelope'
  | 'unknown_method'
  // — the gate, in fixed order —
  | 'undeclared_capability'
  | 'permission_denied'
  | 'invalid_params'
  // — execution —
  | 'handler_error'
  // — client-side (the marshaller), surfaced to the bundle as a rejected Promise —
  | 'syscall_timeout'
  | 'transport_unavailable';

export interface BridgeError {
  kind: BridgeErrorKind;
  method?: string;
  capability?: string;
  /** Always present: a one-line, machine-and-human actionable next step (§8.1). */
  hint: string;
}

export function bridgeError(detail: BridgeError): BridgeError {
  return detail;
}

/** A BridgeError or a StorageError — every refusal that can ride a `sysret`. Both shapes share
 *  `{kind, hint}`, so the future repair loop consumes them uniformly. */
export type SyscallError = BridgeError | StorageError;

// ─────────────────────────────────────────────────────────────────────────────
// D5 — the append-only registry row, and the realm record handlers close over
// ─────────────────────────────────────────────────────────────────────────────

/** A params validator: returns null if the params are acceptable, else a one-line reason
 *  (the marshal.ts `checkValue` idiom). Kept as a function, not a JSON-schema doc, so the
 *  registry stays dependency-free and a row's shape check is a few lines. */
export type ParamsValidator = (params: unknown) => string | null;

/** A capability handler. Receives ONLY (params, realm) — it must derive everything it touches
 *  from those two arguments (D5). It returns the JSON result, or throws a StorageEngineError /
 *  Error which the dispatcher turns into a structured `sysret` error. */
export type SyscallHandler = (
  params: { [key: string]: JsonValue },
  realm: RealmRecord,
) => JsonValue | void | Promise<JsonValue | void>;

export interface RegistryRow {
  /** The capability this method requires; gated against the realm's host-held manifest (D4). */
  capability: string;
  paramsSchema: ParamsValidator;
  handler: SyscallHandler;
}

// ─────────────────────────────────────────────────────────────────────────────
// D2 — host-held app record + the per-realm record bound at creation
// ─────────────────────────────────────────────────────────────────────────────

/** The host-held capability declaration (D4). Today it comes from fixture config (extracted
 *  by the build from the bundle's own `defineApp`); in the product it is harness-validated at
 *  generation time and version-store-tracked. The gate reads ONLY this, never the bundle's
 *  runtime self-description. */
export interface AppManifest {
  capabilities: string[];
}

/** The host-side app record — the single source of truth a realm is bound from. */
export interface AppRecord {
  appId: string;
  name: string;
  manifest: AppManifest;
  /** Present iff the app declares storage; the engine `open`s this before the bundle runs (D7). */
  schemaArtifact?: SchemaArtifact;
}

/**
 * The realm record (D2). Created at app launch and bound to exactly one app's manifest +
 * engine handle; the dispatcher closes over it. The envelope has no app field, so a
 * confused-deputy read is not "denied" — it is inexpressible: a handler can only reach
 * `realm.engine`, which is this one app's store.
 */
export interface RealmRecord {
  appId: string;
  manifest: AppManifest;
  schemaArtifact?: SchemaArtifact;
  /** The opened per-app engine handle, or null for a Tier-0 app that declares no storage. */
  engine: StorageEngine | null;
  /** Bumped on every realm reset (D3). A frame stamped with a stale `gen` is dropped. */
  generation: number;
  /** Teardown fence (D3): set false when the realm is reset, so a late handler result that
   *  completes after teardown is discarded rather than delivered into the successor realm. */
  alive: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope validation (used by the dispatcher before the gate)
// ─────────────────────────────────────────────────────────────────────────────

/** Validate the shape of an inbound syscall frame. Returns the typed frame or a reason. */
export function validateSyscall(frame: unknown): { ok: true; frame: SyscallFrame } | { ok: false; id: number | null; reason: string } {
  if (!frame || typeof frame !== 'object') return { ok: false, id: null, reason: 'frame is not an object' };
  const f = frame as Record<string, unknown>;
  if (f.whim !== 'syscall') return { ok: false, id: null, reason: 'not a syscall frame' };
  const id = typeof f.id === 'number' && Number.isFinite(f.id) ? (f.id as number) : null;
  if (f.v !== SYSCALL_VERSION) return { ok: false, id, reason: `unsupported envelope version ${String(f.v)}` };
  if (id === null) return { ok: false, id: null, reason: 'missing/invalid request id' };
  if (typeof f.gen !== 'number' || !Number.isFinite(f.gen)) return { ok: false, id, reason: 'missing/invalid generation' };
  if (typeof f.method !== 'string' || !f.method) return { ok: false, id, reason: 'missing method' };
  if (f.params === null || typeof f.params !== 'object' || Array.isArray(f.params)) {
    return { ok: false, id, reason: 'params must be an object' };
  }
  return { ok: true, frame: f as unknown as SyscallFrame };
}

export function okSysret(id: number, result: JsonValue | undefined): SysretFrame {
  return { whim: 'sysret', v: SYSCALL_VERSION, id, ok: true, result: result === undefined ? null : result };
}

export function errSysret(id: number, error: SyscallError): SysretFrame {
  return { whim: 'sysret', v: SYSCALL_VERSION, id, ok: false, error };
}
