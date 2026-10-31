/**
 * static-check-pipeline — the shared contract (design D4/D6, `handoff/contract.md`).
 *
 * This file is the inter-chain SEAM (the storage-engine `contract.ts` precedent): types
 * plus small const tables, NO engine logic, NO import of the checker or of any runtime
 * module, so it stands alone and is importable by the checker itself, its test suite, and
 * (task 9.1) the shared server contract package's re-export. `AppliedSchema` is deliberately
 * NOT declared here — it is owned by `src/host/storage-engine/schema.ts` and the checker's
 * public entry (`checks/index.ts`) imports it from there. The tile-identity names are imported
 * TYPE-ONLY from `src/design/` (pure data modules), so this file still loads nothing at runtime.
 */

import type { TintName } from '../src/design/tokens';
import type { FALLBACK_ICON, GlyphName } from '../src/design/icons/names';

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic shape (harness-diagnostics spec, all 4 requirements)
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

/**
 * Closed, centrally-owned vocabulary (harness-diagnostics req 2). Two families:
 *
 *  - VERBATIM-REUSED (P4): these names are NOT ours to invent — they already exist as
 *    runtime/engine kind strings and MUST match exactly so the repair model sees one
 *    vocabulary for one mistake.
 *      - bridge gate:            `undeclared_capability`
 *      - this checker's own dual: `unused_capability` (no runtime analog — declared but
 *        never exercised is only observable statically)
 *      - storage-engine `validateArtifact`: `invalid_artifact`, `malformed_id`, `id_reuse`,
 *        `bad_field_type`, `bad_default`
 *      - storage-engine `diffSchemas`:      `type_change`, `tombstone_violation`,
 *        `missing_default`
 *  - RUNTIME-OBSERVED (synthetic-run-harness, added additively by chain 5 — harness-diagnostics
 *    req 2, `handoff/observe-api.md`/`handoff/capability-trace.md`): kinds only a live run can
 *    produce, never a static pass. Bridge/storage denial kinds a run surfaces (e.g.
 *    `undeclared_capability`) reuse the VERBATIM-REUSED rows above, not duplicated here.
 *      - `runtime_throw`         — an uncaught exception escaped the candidate (CDP
 *        `Runtime.exceptionThrown`, trusted-vantage)
 *      - `unhandled_rejection`   — a rejected Promise with no handler (same CDP channel)
 *      - `mount_timeout`         — no nonce-authenticated `paint` frame within the mount budget
 *      - `run_truncated`         — the total wall-clock budget fired; the page was hard-killed
 *      - `containment_failure`   — the nonce-authenticated `probes` frame itself reported a breach
 *      - `containment_unobserved` — no authenticated containment verdict was observed (the harness
 *        never heard back, so neither containment nor a breach was established). A third kind, NOT
 *        a rename of `containment_failure` (an authenticated verdict reporting a breach) nor of
 *        `mount_timeout` (no authenticated `paint` frame in the mount budget): a verdict can go
 *        unobserved without a mount timeout, and no producer may emit one of the three for another.
 *      - `unreachable_screen`    — a declared screen no navigate call names (cold-mounted, warning)
 *      - `missing_schema`        — `launchApp` refused: `storage` declared, no schema artifact
 *        shipped (`src/host/bridge/launch.ts`'s own `LaunchResult` kind, reused verbatim — not
 *        caught by the static schema-check pass, which only runs when a `schema` literal IS
 *        present)
 *      - `launch_failed`         — `launchApp`'s defensive fallback for a launch-time engine
 *        failure that is not itself a structured `StorageError`
 *  - GENERATION-LOOP (added additively by chain 5, `handoff/stage-contracts.md`): kinds the
 *    generation pipeline itself introduces, neither reused nor runtime-observed.
 *      - `id_below_floor` — the schema pass's own new diagnostic (`schema-check.ts`): an
 *        applied-schema-supplied candidate introduces a field ID at or below its collection's
 *        monotone burned-ID floor (#52 D5) — a never-allocated gap below the union's max,
 *        invisible to `diffSchemas` alone.
 *      - `build_failure`   — the concrete `BuildStage` maps a production-builder throw to this
 *        single error diagnostic rather than propagating the exception (design D2/D12).
 *      - `schema_identity_drift` — an edit candidate abandons a collection or an active field ID
 *        the applied schema contains (the user's existing rows would become unreachable).
 *      - `storage_surface_drift` — an edit candidate stops reading a storage location the
 *        previous source read.
 *      - `storage_surface_dynamic` — a storage-facade argument that is not a string literal, so
 *        the location it names is unprovable in both directions. The ONE warning-severity member
 *        of this set.
 *  - VERBATIM-REUSED: storage-engine VERB-TIME denial kinds (`src/host/storage-engine/contract.ts`'s
 *    `StorageErrorKind`). A syscall a synthetic run observes refused has a name here and so cannot
 *    be dropped for lack of one: `type_mismatch`, `unknown_collection`, `unknown_field`,
 *    `unknown_record`, `unqueryable_field`, `kv_too_large`.
 *    EXCLUDED, deliberately: the engine's HOST-FAULT kinds `not_open` and `corrupt_storage`. They
 *    report the harness's own engine state, carry no fix the model could apply, and are surfaced
 *    through the run report's trace instead. No producer may rename a host fault into one of the
 *    kinds above in order to report it.
 *  - NEW (authored here by Chain B from the static-checks spec, task 1.2/2.1): once
 *    authored this set is closed too — downstream stages extend the union additively,
 *    never by minting ad-hoc kind strings elsewhere.
 *      - `parse_error`         — TS syntax error (req "Parse gate runs first and alone")
 *      - `disallowed_import`   — off-allowlist specifier, `require(...)`, or dynamic
 *                                `import(...)` (req "Imports resolve only to vc-sdk")
 *      - `forbidden_global`    — direct/aliased/computed-on-alias/`.constructor` reference
 *                                to a forbidden global (req "Forbidden-global walk closes T8")
 *      - `prototype_pollution` — `__proto__` write or a shared-prototype
 *                                `defineProperty`/`setPrototypeOf`/`assign` (same requirement)
 *      - `implicit_eval`       — string-argument `setTimeout`/`setInterval` (same requirement)
 *      - `manifest_not_static` — missing/duplicated `defineApp` default export, or a
 *                                manifest field that isn't a literal (req "app manifest is
 *                                extracted statically, literal-only")
 *      - `unresolved_screen`   — `initial` or a nav-call target names no declared screen
 *                                (req "Screen graph resolves statically")
 *      - `raw_timer`           — raw `setTimeout`/`setInterval`/`requestAnimationFrame`
 *                                (function-arg form) instead of the SDK's `delay`/`interval`
 *                                (req "SDK lint steers toward the taught path")
 *      - `post_floor_builtin`  — a JS built-in newer than the WebView floor (`POST_FLOOR_BUILTINS`
 *                                below): it throws a TypeError in the oldest supported WebView
 *  - TILE IDENTITY (design-system-v1 D5, `handoff/generator.md`): WARNING-ONLY, emitted by the
 *    manifest-extraction pass when it resolves a declared `tint`/`icon` name. A name never fails a
 *    build or costs a repair turn, so the server's check stage keeps these out of the repair loop
 *    (`TILE_DIAGNOSTIC_KINDS` below). The three icon kinds reuse `src/design/icons/names.ts`'s
 *    `IconDiagnosticKind` verbatim.
 *      - `tint_alias`    — a declared tint was an alias (`teal` → `ocean`)
 *      - `tint_fallback` — a declared tint resolved to none of the ten (or was not a string
 *                          literal) and was dropped; the device falls back by app id
 *      - `icon_alias` / `icon_keyword` / `icon_fallback` — the glyph resolver's own three outcomes
 *
 * Array-first: `DiagnosticKind` (below) is derived from `DIAGNOSTIC_KINDS` via `typeof …
 * [number]` so the type and the runtime self-check list (task 2.3's harness self-test)
 * can never drift apart.
 */
export const DIAGNOSTIC_KINDS = [
  // — new, authored here —
  'parse_error',
  'disallowed_import',
  'forbidden_global',
  'prototype_pollution',
  'implicit_eval',
  'manifest_not_static',
  'unresolved_screen',
  'raw_timer',
  // — verbatim-reused: capability directions (P4) —
  'undeclared_capability',
  'unused_capability',
  // — verbatim-reused: storage-engine validateArtifact kinds (P4) —
  'invalid_artifact',
  'malformed_id',
  'id_reuse',
  'bad_field_type',
  'bad_default',
  // — verbatim-reused: storage-engine diffSchemas conflict kinds (P4) —
  'type_change',
  'tombstone_violation',
  'missing_default',
  // — runtime-observed (synthetic-run-harness, chain 5) —
  'runtime_throw',
  'unhandled_rejection',
  'mount_timeout',
  'run_truncated',
  'containment_failure',
  'containment_unobserved',
  'unreachable_screen',
  'missing_schema',
  'launch_failed',
  // — generation-loop (chain 5) —
  'id_below_floor',
  'build_failure',
  // — generation-loop: edit-continuity (rewrite-preserves-user-data) —
  'schema_identity_drift',
  'storage_surface_drift',
  'storage_surface_dynamic',
  // — verbatim-reused: storage-engine VERB-TIME denial kinds (P4). The engine's HOST-FAULT kinds
  //   `not_open`/`corrupt_storage` are deliberately EXCLUDED — they name the harness's own engine
  //   state, not a candidate mistake, and are reported through the run trace instead. —
  'type_mismatch',
  'unknown_collection',
  'unknown_field',
  'unknown_record',
  'unqueryable_field',
  'kv_too_large',
  // — WebView floor: a JS built-in the oldest supported WebView lacks (throws a TypeError there) —
  'post_floor_builtin',
  // — tile identity (design-system-v1 D5): warning-only, never repaired —
  'tint_alias',
  'tint_fallback',
  'icon_alias',
  'icon_keyword',
  'icon_fallback',
] as const;

export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];

/** The tile-identity kinds: always `warning`, recorded for the build and the eval, and never fed
 *  to the repair loop (generation-pipeline "The delivered app record is harness-validated"). */
export const TILE_DIAGNOSTIC_KINDS = ['tint_alias', 'tint_fallback', 'icon_alias', 'icon_keyword', 'icon_fallback'] as const satisfies readonly DiagnosticKind[];

export type TileDiagnosticKind = (typeof TILE_DIAGNOSTIC_KINDS)[number];

/**
 * A single structured diagnostic (harness-diagnostics req 1). `hint` is REQUIRED and
 * non-empty — no free-text-only diagnostic may exist. `line` is REQUIRED here: unlike the
 * shared wire shape (whose runtime producers may have no source anchor), every
 * static-check diagnostic anchors to the original TypeScript source the model emitted.
 */
export interface Diagnostic {
  kind: DiagnosticKind;
  severity: Severity;
  /** 1-based line in the original TS source. */
  line: number;
  /** 1-based column in the original TS source, when known. */
  column?: number;
  /** The offending identifier/specifier/field name, when applicable. */
  symbol?: string;
  message: string;
  /** A one-line, actionable next step shaped like the right SDK answer. Mandatory. */
  hint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifest + report shapes (design D5/D8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The statically-extracted `defineApp({...})` argument (AST literals only — design D5).
 * Present on the report whenever extraction succeeded, even alongside other failures
 * (static-checks req "app manifest is extracted statically").
 */
export interface ExtractedManifest {
  name: string;
  initial: string;
  /** Screen display name → true (the checker never evaluates the component value). */
  screens: Record<string, true>;
  capabilities: string[];
  /** The raw `schema` literal, when declared — validated separately by the schema pass. */
  schema?: unknown;
  /** The app's declared tile colour, when it was declared AS A STRING LITERAL. Legacy (deprecated
   *  by `tint`): carried through this one extraction unvalidated, for the host to map to a tint. */
  tileColor?: string;
  /** The declared `tint` (a name or a list), resolved to the closed set: ranked, aliases applied,
   *  unknown names dropped, duplicates removed, at most three. Absent when nothing resolved — the
   *  device then falls back by app id. */
  tint?: TintName[];
  /** The declared `icon`, resolved against the glyph set (aliases, keywords on the name then the
   *  app name, else `circle`). Absent when no string literal was declared. */
  icon?: GlyphName | typeof FALLBACK_ICON;
}

/**
 * The pipeline's output (design D8). `ok` is a pure function of `diagnostics.length` — no
 * severity-threshold knob (harness-diagnostics req 3).
 */
export interface CheckReport {
  /** `true` IFF `diagnostics.length === 0` (any severity — one warning still fails `ok`). */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Present whenever `defineApp` extraction succeeded, even on an otherwise-failing report. */
  manifest?: ExtractedManifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data table: forbidden-global names (design D3 — the T8 closer)
// ─────────────────────────────────────────────────────────────────────────────

/** Global roots: a direct reference, OR an alias assigned from one of these, taints. */
export const GLOBAL_ROOTS: readonly string[] = [
  'window',
  'globalThis',
  'self',
  'top',
  'parent',
  'frames',
];

/**
 * Forbidden identifiers reachable directly (as a bare reference) or via a global root/alias
 * (`root.name`). Union of: the neutralize-list names (`src/runtime/web/neutralize.js`), the
 * CSP-killed codegen names, and `document`.
 */
export const FORBIDDEN_DIRECT_NAMES: readonly string[] = [
  // codegen (CSP-handled at runtime; still flagged statically — belt-and-suspenders + the
  // model-steering signal a runtime throw can't give at generation time)
  'eval',
  'Function',
  // DOM root
  'document',
  // neutralize-list (network + ambient persistence + threading)
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'RTCPeerConnection',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
];

/** Forbidden MEMBER paths reachable only through a global root/alias (not bare identifiers
 *  in module scope — `navigator` itself is not forbidden, only `navigator.sendBeacon`). */
export const FORBIDDEN_MEMBER_PATHS: readonly (readonly string[])[] = [['navigator', 'sendBeacon']];

// ─────────────────────────────────────────────────────────────────────────────
// Data table: built-ins above the WebView floor
// ─────────────────────────────────────────────────────────────────────────────

/** The oldest Chromium a mini-app's WebView may be: the Android 10 (API 29) system image's
 *  WebView, the oldest one tested. esbuild (`target: 'es2019'`) lowers syntax for it but never
 *  polyfills a built-in, so a built-in shipped after this version throws a TypeError there. */
export const WEBVIEW_FLOOR_CHROMIUM = 91;

/** A JS built-in shipped after `WEBVIEW_FLOOR_CHROMIUM`, in the shape its use takes in source:
 *  - `method`: a call `x.name(...)` on any receiver (the receiver's type is unknown to a
 *    syntactic pass; a feature test such as `typeof x.at` is not a call and is not matched);
 *  - `static`: any reference to `owner.name` where `owner` is the real global;
 *  - `global`: any reference to the global `name`.
 *  Known boundary: iterator-helper calls (`map.values().map(...)`) share names with Array
 *  methods and are not matched. */
export interface PostFloorBuiltin {
  form: 'method' | 'static' | 'global';
  owner?: string;
  name: string;
  /** The first Chromium that ships it. */
  chromium: number;
  /** The floor-safe way to write it, for the diagnostic hint. */
  instead: string;
}

export const POST_FLOOR_BUILTINS: readonly PostFloorBuiltin[] = [
  { form: 'method', name: 'at', chromium: 92, instead: 'index directly: `xs[xs.length - 1]`, `xs[i]`' },
  { form: 'static', owner: 'Object', name: 'hasOwn', chromium: 93, instead: '`Object.keys(obj).includes(key)`' },
  { form: 'method', name: 'findLast', chromium: 97, instead: '`[...xs].reverse().find(...)`' },
  { form: 'method', name: 'findLastIndex', chromium: 97, instead: 'a loop from the end' },
  { form: 'global', name: 'structuredClone', chromium: 98, instead: '`JSON.parse(JSON.stringify(value))` for JSON data' },
  { form: 'method', name: 'toSorted', chromium: 110, instead: '`[...xs].sort(...)`' },
  { form: 'method', name: 'toReversed', chromium: 110, instead: '`[...xs].reverse()`' },
  { form: 'method', name: 'toSpliced', chromium: 110, instead: 'copy with `[...xs]`, then `splice`' },
  { form: 'method', name: 'with', chromium: 110, instead: '`xs.map((x, j) => (j === i ? value : x))`' },
  { form: 'static', owner: 'Object', name: 'groupBy', chromium: 117, instead: 'a `reduce` into a plain object' },
  { form: 'static', owner: 'Map', name: 'groupBy', chromium: 117, instead: 'a loop that fills a `Map`' },
  { form: 'static', owner: 'Promise', name: 'withResolvers', chromium: 119, instead: '`new Promise((resolve, reject) => ...)`' },
  { form: 'static', owner: 'Array', name: 'fromAsync', chromium: 121, instead: '`Promise.all(...)` over an array' },
  { form: 'method', name: 'union', chromium: 122, instead: '`new Set([...a, ...b])`' },
  { form: 'method', name: 'intersection', chromium: 122, instead: '`new Set([...a].filter((x) => b.has(x)))`' },
  { form: 'method', name: 'difference', chromium: 122, instead: '`new Set([...a].filter((x) => !b.has(x)))`' },
  { form: 'method', name: 'symmetricDifference', chromium: 122, instead: 'two `filter`s over the two sets' },
  { form: 'method', name: 'isSubsetOf', chromium: 122, instead: '`[...a].every((x) => b.has(x))`' },
  { form: 'method', name: 'isSupersetOf', chromium: 122, instead: '`[...b].every((x) => a.has(x))`' },
  { form: 'method', name: 'isDisjointFrom', chromium: 122, instead: '`![...a].some((x) => b.has(x))`' },
  { form: 'static', owner: 'Promise', name: 'try', chromium: 128, instead: '`new Promise((resolve) => resolve(fn()))`' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Data table: export → capability (design D6)
// ─────────────────────────────────────────────────────────────────────────────

/** One row per capability-backed `vc-sdk` export (as-built: two namespace-object facades).
 *  No `diag` row — it has no SDK facade (only reachable via the raw syscall transport), so
 *  a declared-but-unreachable `diag` capability always draws `unused_capability`. */
export interface CapabilityExportRow {
  /** The `vc-sdk` export name a use of the capability goes through. */
  sdkExport: string;
  /** The manifest `capabilities` array entry this export implies. */
  capability: string;
}

export const CAPABILITY_EXPORTS: readonly CapabilityExportRow[] = [
  { sdkExport: 'storage', capability: 'storage' },
  { sdkExport: 'cues', capability: 'cues' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Data table: nav-call shapes (design D6/D4 — sdk-navigation)
// ─────────────────────────────────────────────────────────────────────────────

/** A recognized navigation call shape: `object.method(...)` where the `argIndex`-th
 *  argument is the string-literal navigation target. Rows are data; adding an SDK target-taking
 *  call does not change the checker (static-checks req "Screen graph resolves statically"). */
export interface NavCallShape {
  object: string;
  method: string;
  /** Zero-based index of the target-screen argument. */
  argIndex: number;
}

export const NAV_CALL_SHAPES: readonly NavCallShape[] = [
  { object: 'nav', method: 'navigate', argIndex: 0 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Data table: SDK-lint rules (design D8 — raw timers steer to delay/interval)
// ─────────────────────────────────────────────────────────────────────────────

export interface SdkLintRule {
  /** The raw global identifier this rule steers away from. */
  globalName: string;
  /** The `vc-sdk` export the hint should name instead. */
  sdkAlternative: string;
}

export const SDK_LINT_RULES: readonly SdkLintRule[] = [
  { globalName: 'setTimeout', sdkAlternative: 'delay' },
  { globalName: 'setInterval', sdkAlternative: 'interval' },
  { globalName: 'requestAnimationFrame', sdkAlternative: 'interval' },
];
