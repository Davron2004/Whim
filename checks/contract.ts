/**
 * static-check-pipeline — the shared contract (design D4/D6, `handoff/contract.md`).
 *
 * This file is the inter-chain SEAM (the storage-engine `contract.ts` precedent): types
 * plus small const tables, NO engine logic, NO import of the checker or of any runtime
 * module, so it stands alone and is importable by the checker itself, its test suite, and
 * (task 9.1) the shared server contract package's re-export. `AppliedSchema` is deliberately
 * NOT declared here — it is owned by `src/host/storage-engine/schema.ts` and the checker's
 * public entry (`checks/index.ts`) imports it from there.
 */

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
 *
 * Array-first: `DiagnosticKind` (below) is derived from `DIAGNOSTIC_KINDS` via `typeof …
 * [number]` so the type and the runtime self-check list (task 2.3's harness self-test —
 * greenBy:B) can never drift apart.
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
] as const;

export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];

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
