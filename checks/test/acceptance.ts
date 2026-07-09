/**
 * Node acceptance for the static-check pipeline (design D8/D9 — TDD per §16.2, tests-first).
 * Chain B authors the FULL B–E corpus up front; every `test()` call is tagged `greenBy` per
 * `handoff/greenby-harness.md`'s schedule. Under `.phase = 'B'` only the `greenBy:'B'` tests
 * are due — everything else is expected/tolerated PENDING (the public entry, `runStaticChecks`,
 * is a deliberate "not implemented" stub until Chains C/D/E build the passes it composes).
 *
 * Black-box style throughout (design D8): every scenario test drives `runStaticChecks(source,
 * opts)` and reads the returned `CheckReport` — never a pass-internal function. Individual
 * pass internals (if any chain adds them) are documented in `handoff/checker-internals.md`
 * (Chain C), not depended on here.
 *
 * Sections (one function per section below, run in order by `main()`):
 *   §B0  contract.ts + harness self-tests                          (greenBy: B)
 *   §C1  parse gate                                                 (greenBy: C)
 *   §C2  import allowlist                                           (greenBy: C)
 *   §C3  forbidden-global walk (T8) + shadowing + no-suppression    (greenBy: C)
 *   §D1  manifest extraction                                        (greenBy: D)
 *   §D2  capability declarations ⇄ use, both directions             (greenBy: D)
 *   §D3  screen graph                                                (greenBy: D)
 *   §D4  SDK lint                                                    (greenBy: D)
 *   §D5  schema check (validate + diff)                              (greenBy: D)
 *   §E1  assembly: ordering / purity / determinism                   (greenBy: E)
 *   §E2  honest fixtures (zero-diagnostics) + latency-probe pinned   (greenBy: E)
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, report, assert, assertHasKind, assertNoKind, kindsOf } from './harness';
import { runHostileCorpus } from './hostile/corpus';
import {
  CAPABILITY_EXPORTS,
  CheckReport,
  DIAGNOSTIC_KINDS,
  DiagnosticKind,
  FORBIDDEN_DIRECT_NAMES,
  GLOBAL_ROOTS,
  NAV_CALL_SHAPES,
  NavCallShape,
  SDK_LINT_RULES,
} from '../contract';
import { runStaticChecks } from '../index';
import { AppliedSchema, diffSchemas } from '../../src/host/storage-engine/schema';
import { SchemaArtifact } from '../../src/host/storage-engine/contract';

/** Every diagnostic in the report is well-formed per harness-diagnostics req 1/2. */
function assertAllWellFormed(r: CheckReport): void {
  for (const d of r.diagnostics) {
    assert((DIAGNOSTIC_KINDS as readonly string[]).includes(d.kind), `diagnostic kind "${d.kind}" is not in the closed DIAGNOSTIC_KINDS union`);
    assert(d.severity === 'error' || d.severity === 'warning', `diagnostic severity must be 'error'|'warning', got ${String(d.severity)}`);
    assert(typeof d.hint === 'string' && d.hint.trim().length > 0, `diagnostic ${d.kind} has no non-empty hint (mandatory, harness-diagnostics req 1)`);
    assert(Number.isInteger(d.line) && d.line >= 1, `diagnostic ${d.kind} must carry a 1-based line, got ${String(d.line)}`);
  }
}

function readFixture(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf8');
}

function appSource(capabilities: string, imports = 'defineApp', homeBody = 'return null;', setup = '', name = 'T'): string {
  return `
import { ${imports} } from 'vc-sdk';
function Home() {
  ${homeBody}
}
${setup}
export default defineApp({
  name: '${name}', initial: 'Home', screens: { Home }, capabilities: ${capabilities},
});
`;
}

function schemaAppSource(fieldType: string, typed = false): string {
  const typeImport = typed ? ', type SchemaArtifact' : '';
  const annotation = typed ? ': SchemaArtifact' : '';
  return `
import { defineApp${typeImport} } from 'vc-sdk';
function Home() { return null; }
const SCHEMA${annotation} = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: '${fieldType}' } } } },
};
export default defineApp({
  name: 'T', initial: 'Home', screens: { Home }, capabilities: [], schema: SCHEMA,
});
`;
}

// ── §B0 contract.ts + harness self-tests (greenBy: B) ──────────────────────

async function testContractAndHarnessSelfTests(): Promise<void> {
  await test('B §contract: DiagnosticKind union is closed and matches the P4 verbatim-reused names', () => {
    const expected = [
      'parse_error',
      'disallowed_import',
      'forbidden_global',
      'prototype_pollution',
      'implicit_eval',
      'manifest_not_static',
      'unresolved_screen',
      'raw_timer',
      'undeclared_capability',
      'unused_capability',
      'invalid_artifact',
      'malformed_id',
      'id_reuse',
      'bad_field_type',
      'bad_default',
      'type_change',
      'tombstone_violation',
      'missing_default',
    ];
    assert(DIAGNOSTIC_KINDS.length === expected.length, `expected ${expected.length} kinds, got ${DIAGNOSTIC_KINDS.length}`);
    assert(new Set(DIAGNOSTIC_KINDS).size === DIAGNOSTIC_KINDS.length, 'DIAGNOSTIC_KINDS must have no duplicates');
    for (const k of expected) {
      assert((DIAGNOSTIC_KINDS as readonly string[]).includes(k), `DIAGNOSTIC_KINDS is missing verbatim-reused/authored kind "${k}"`);
    }
  });

  await test('B §contract: GLOBAL_ROOTS + FORBIDDEN_DIRECT_NAMES tables are well-formed', () => {
    assert(GLOBAL_ROOTS.length > 0, 'GLOBAL_ROOTS must not be empty');
    for (const root of ['window', 'globalThis', 'self', 'top', 'parent', 'frames']) {
      assert((GLOBAL_ROOTS as readonly string[]).includes(root), `GLOBAL_ROOTS missing "${root}"`);
    }
    for (const name of ['eval', 'Function', 'document', 'fetch']) {
      assert((FORBIDDEN_DIRECT_NAMES as readonly string[]).includes(name), `FORBIDDEN_DIRECT_NAMES missing "${name}"`);
    }
  });

  await test('B §contract: CAPABILITY_EXPORTS has exactly storage + cues rows, no diag row', () => {
    const caps = CAPABILITY_EXPORTS.map((r) => r.capability).sort((a, b) => a.localeCompare(b));
    assert(JSON.stringify(caps) === JSON.stringify(['cues', 'storage']), `expected capability rows [cues, storage], got [${caps.join(', ')}]`);
    assert(!CAPABILITY_EXPORTS.some((r) => r.capability === 'diag'), 'diag must have NO row (no SDK facade)');
  });

  await test('B §contract: NAV_CALL_SHAPES ships EMPTY (#3 landed no nav API)', () => {
    assert(NAV_CALL_SHAPES.length === 0, `NAV_CALL_SHAPES must ship empty, got ${NAV_CALL_SHAPES.length} rows`);
  });

  await test('B §contract: SDK_LINT_RULES steers setTimeout/setInterval/requestAnimationFrame', () => {
    const names = SDK_LINT_RULES.map((r) => r.globalName).sort((a, b) => a.localeCompare(b));
    assert(
      JSON.stringify(names) === JSON.stringify(['requestAnimationFrame', 'setInterval', 'setTimeout']),
      `expected the three raw-timer rule names, got [${names.join(', ')}]`,
    );
  });

  const selfTestMarker: string[] = [];
  await test('B §harness: legacy untagged test() call runs its body (defaults to greenBy:B, due now)', () => {
    selfTestMarker.push('legacy-ran');
  });
  await test('B §harness: explicitly-tagged {greenBy:"B"} test() call runs its body', { greenBy: 'B' }, () => {
    selfTestMarker.push('tagged-B-ran');
  });
  await test('B §harness: both due-now forms above actually executed (self-test)', () => {
    assert(selfTestMarker.includes('legacy-ran'), 'the untagged test() call should have executed (greenBy defaults to B, which is due at phase B)');
    assert(selfTestMarker.includes('tagged-B-ran'), 'the explicitly-tagged greenBy:B test() call should have executed');
  });
}

// ── §C1 parse gate (greenBy: C) — "Parse gate runs first and alone" ────────

async function testParseGate(): Promise<void> {
  await test('C §parse: a syntax error short-circuits — only parse_error diagnostics, at the offending line', { greenBy: 'C' }, () => {
    const src = "import { defineApp } from 'vc-sdk';\nconst x = ;\n";
    const r = runStaticChecks(src);
    const parseErr = assertHasKind(r, 'parse_error');
    assert(parseErr.line === 2, `expected the parse_error at line 2, got line ${parseErr.line}`);
    assert(
      r.diagnostics.every((d) => d.kind === 'parse_error'),
      'no later-pass diagnostics may appear once parse has failed — the report is noise-free',
    );
  });
}

// ── §C2 import allowlist (greenBy: C) — "Imports resolve only to vc-sdk" ───

async function testImportAllowlist(): Promise<void> {
  await test('C §imports: off-allowlist static specifiers are rejected, naming the specifier', { greenBy: 'C' }, () => {
    for (const specifier of ['lodash', 'react', 'react/jsx-runtime', './local', 'vc-sdk/ui']) {
      const src = `import x from '${specifier}';\n`;
      const r = runStaticChecks(src);
      const d = assertHasKind(r, 'disallowed_import', `no disallowed_import for specifier "${specifier}"`);
      assert(d.symbol === specifier, `expected symbol "${specifier}", got "${String(d.symbol)}"`);
      assert(/vc-sdk/.test(d.hint), `hint should point at vc-sdk for specifier "${specifier}", got: ${d.hint}`);
    }
  });

  await test('C §imports: require(...) is rejected with a hint naming vc-sdk', { greenBy: 'C' }, () => {
    const src = "const x = require('vc-sdk');\n";
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'disallowed_import');
    assert(/vc-sdk/.test(d.hint), `hint should name vc-sdk, got: ${d.hint}`);
  });

  await test('C §imports: dynamic import() is rejected regardless of specifier', { greenBy: 'C' }, () => {
    const src = "async function boot() { await import('vc-sdk'); }\n";
    const r = runStaticChecks(src);
    assertHasKind(r, 'disallowed_import', 'dynamic import() must be rejected even when the specifier is on-allowlist');
  });
}

// ── §C3 forbidden-global walk (greenBy: C) — "Forbidden-global walk closes T8" ──

async function testForbiddenGlobalsWalk(): Promise<void> {
  await test('C §globals: direct reference to a forbidden name is flagged', { greenBy: 'C' }, () => {
    const r = runStaticChecks("fetch('http://evil.example');\n");
    assertHasKind(r, 'forbidden_global');
  });

  await test('C §globals: bare reference to a global root is itself flagged', { greenBy: 'C' }, () => {
    const r = runStaticChecks('const x = globalThis;\nvoid x;\n');
    assertHasKind(r, 'forbidden_global');
  });

  await test('C §globals: member access through an alias is flagged (taint follows lexical assignment)', { greenBy: 'C' }, () => {
    const r = runStaticChecks("const g = globalThis;\nconst h = g;\nh.fetch('x');\n");
    assertHasKind(r, 'forbidden_global');
  });

  await test('C §globals: computed access on a tainted alias is flagged even with an unknown key (token scan would miss it)', { greenBy: 'C' }, () => {
    const src = "const g = globalThis;\nconst k = 'fe' + 'tch';\ng[k]('url');\n";
    const r = runStaticChecks(src);
    assertHasKind(r, 'forbidden_global', 'no fetch token appears in the source — only binding resolution catches this');
  });

  await test('C §globals: .constructor access is flagged (prototype-walk codegen)', { greenBy: 'C' }, () => {
    const r = runStaticChecks("({}).constructor.constructor('return 1')();\n");
    assertHasKind(r, 'forbidden_global');
  });

  await test('C §globals: Object.prototype pollution attempt is flagged, naming the pollution pattern', { greenBy: 'C' }, () => {
    const r = runStaticChecks("Object.defineProperty(Object.prototype, 'x', { value: 1 });\n");
    assertHasKind(r, 'prototype_pollution');
  });

  await test('C §globals: string-argument setTimeout/setInterval is flagged as implicit eval', { greenBy: 'C' }, () => {
    const r = runStaticChecks("setTimeout('doEvil()', 1000);\n");
    assertHasKind(r, 'implicit_eval');
  });

  await test('C §globals: honest shadowing (a local binding named like a forbidden global) is NOT flagged', { greenBy: 'C' }, () => {
    const src = "function f(fetch: string): string {\n  return fetch + '!';\n}\nf('a');\n";
    const r = runStaticChecks(src);
    assertNoKind(r, 'forbidden_global', 'a parameter named "fetch", used only as a plain local value, must not be flagged');
  });

  await test('C §globals: a forbidden-global diagnostic carries a non-empty, SDK-shaped hint (harness-diagnostics req 1)', { greenBy: 'C' }, () => {
    const r = runStaticChecks("fetch('http://evil.example');\n");
    const d = assertHasKind(r, 'forbidden_global');
    assert(d.hint.trim().length > 0, 'hint must be non-empty');
    assertAllWellFormed(r);
  });

  await test('C §globals: no inline pragma suppresses a diagnostic (harness-diagnostics req 4)', { greenBy: 'C' }, () => {
    const src = "// whim-disable-next-line forbidden-global\nfetch('http://evil.example');\n";
    const r = runStaticChecks(src);
    assertHasKind(r, 'forbidden_global', 'a disable-style comment pragma must not suppress the diagnostic — there is no suppression mechanism');
  });
}

// ── §D1 manifest extraction (greenBy: D) — "app manifest is extracted statically" ──

async function testManifestExtraction(): Promise<void> {
  await test('D §manifest: computed capabilities are rejected (identifier indirection and string-built elements)', { greenBy: 'D' }, () => {
    const identifierSrc = appSource('someArray', 'defineApp', 'return null;', "const someArray = ['storage'];");
    const r1 = runStaticChecks(identifierSrc);
    const d1 = assertHasKind(r1, 'manifest_not_static');
    assert(/literal/i.test(d1.hint), `hint should require a literal array, got: ${d1.hint}`);

    const concatSrc = appSource("['sto' + 'rage']");
    const r2 = runStaticChecks(concatSrc);
    assertHasKind(r2, 'manifest_not_static');
  });

  await test('D §manifest: extraction survives a later failure — the report still carries the manifest', { greenBy: 'D' }, () => {
    const src = appSource('[]', 'defineApp', 'return null;', "fetch('http://evil.example');", 'Honest Name');
    const r = runStaticChecks(src);
    assert(r.ok === false, 'the forbidden-global violation must still fail the report');
    assert(!!r.manifest, 'the manifest must be present even though the report is failing');
    assert(r.manifest?.name === 'Honest Name', `expected manifest.name "Honest Name", got ${String(r.manifest?.name)}`);
    assert(r.manifest?.initial === 'Home', `expected manifest.initial "Home", got ${String(r.manifest?.initial)}`);
  });
}

// ── §D2 capability directions (greenBy: D) ──────────────────────────────────

async function testCapabilityDirections(): Promise<void> {
  await test('D §capabilities: used but undeclared → undeclared_capability error naming the capability (matches the bridge gate kind)', { greenBy: 'D' }, () => {
    const src = appSource('[]', 'defineApp, storage', 'return null;', "storage.kv.set('k', 1);");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'undeclared_capability');
    assert(d.severity === 'error', 'undeclared_capability must be an error (the runtime gate would deny it)');
    assert(d.symbol === 'storage', `expected symbol "storage", got "${String(d.symbol)}"`);
    assert(/capabilities/.test(d.hint), `hint should show the corrected capabilities array, got: ${d.hint}`);
  });

  await test('D §capabilities: declared but unused → unused_capability warning naming the capability', { greenBy: 'D' }, () => {
    const src = appSource("['storage']");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'unused_capability');
    assert(d.severity === 'warning', 'unused_capability must be a warning (§5.4 — the consent sheet must not list ghosts)');
    assert(d.symbol === 'storage', `expected symbol "storage", got "${String(d.symbol)}"`);
  });

  await test('D §diagnostics: static undeclared_capability matches the runtime bridge gate kind string verbatim (harness-diagnostics req 2)', { greenBy: 'D' }, () => {
    const src = appSource('[]', 'defineApp, storage', 'return null;', "storage.kv.get('k');");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'undeclared_capability');
    assert(d.kind === ('undeclared_capability' as DiagnosticKind), 'the static kind string must be identical to the bridge gate denial kind "undeclared_capability"');
  });

  // ── §D2b capability shadow guard (greenBy: D, reviewer capfix Finding 1/3) — a root
  // identifier only counts as SDK-export use when it resolves to the `vc-sdk` import, not by
  // root-identifier-TEXT matching alone (a local shadow of the same name must not count).

  await test('D §capabilities: a local shadow of an imported-but-unused SDK export is NOT counted as use — no false-positive undeclared_capability', { greenBy: 'D' }, () => {
    const src = appSource('[]', 'defineApp, storage', "const storage = { value: 'not the SDK' };\n  return storage.value;");
    const r = runStaticChecks(src);
    assertNoKind(r, 'undeclared_capability', 'a local const "storage" shadowing the (unused) vc-sdk import must not be treated as SDK use');
  });

  await test('D §capabilities: a declared capability whose only "storage" reference is a local shadow still draws unused_capability — the shadow must not mask it', { greenBy: 'D' }, () => {
    const src = appSource("['storage']", 'defineApp, storage', "const storage = { value: 'not the SDK' };\n  return storage.value;");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'unused_capability', 'the shadow must not suppress the genuinely-unused "storage" capability warning');
    assert(d.symbol === 'storage', `expected symbol "storage", got "${String(d.symbol)}"`);
  });

  await test('D §capabilities: a real vc-sdk storage use is still flagged undeclared (positive control — the fix must not over-correct)', { greenBy: 'D' }, () => {
    const src = appSource('[]', 'defineApp, storage', "storage.kv.set('k', 1);\n  return null;");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'undeclared_capability', 'a genuine vc-sdk storage use with no declared capability must still be flagged');
    assert(d.symbol === 'storage', `expected symbol "storage", got "${String(d.symbol)}"`);
  });

  await test('D §manifest: two default-exported defineApp calls draw a manifest_not_static diagnostic (duplicate lock-in)', { greenBy: 'D' }, () => {
    const src = `${appSource('[]')}
export default defineApp({
  name: 'T2', initial: 'Home', screens: { Home }, capabilities: [],
});
`;
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'manifest_not_static', 'a duplicated default-exported defineApp must be rejected');
    assert(d.symbol === 'defineApp', `expected symbol "defineApp", got "${String(d.symbol)}"`);
  });
}

// ── §D3 screen graph (greenBy: D) — "Screen graph resolves statically" ─────

async function testScreenGraph(): Promise<void> {
  await test('D §screens: unresolvable initial produces an error listing the declared screens', { greenBy: 'D' }, () => {
    const src = `
import { defineApp } from 'vc-sdk';
function Home() { return null; }
export default defineApp({
  name: 'T', initial: 'Hom', screens: { Home }, capabilities: [],
});
`;
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'unresolved_screen');
    assert(/Home/.test(d.hint), `hint should list the declared screens (Home), got: ${d.hint}`);
  });

  await test('D §screens: a dangling nav target is rejected (test-injected shape row proves the empty-table mechanism)', { greenBy: 'D' }, () => {
    const shapes = NAV_CALL_SHAPES as unknown as NavCallShape[];
    const row: NavCallShape = { object: 'nav', method: 'push', argIndex: 0 };
    shapes.push(row);
    try {
      const src = `
import { defineApp } from 'vc-sdk';
declare const nav: { push(screen: string): void };
function Home() {
  nav.push('Settings');
  return null;
}
export default defineApp({
  name: 'T', initial: 'Home', screens: { Home }, capabilities: [],
});
`;
      const r = runStaticChecks(src);
      const d = r.diagnostics.find((x) => x.kind === 'unresolved_screen' && x.symbol === 'Settings');
      assert(!!d, `expected an unresolved_screen diagnostic naming "Settings"; got kinds [${kindsOf(r).join(', ')}]`);
      assert(!!d && /Home/.test(d.hint), `hint should list the declared screens (Home), got: ${d?.hint}`);
    } finally {
      const idx = shapes.indexOf(row);
      if (idx >= 0) shapes.splice(idx, 1);
    }
  });
}

// ── §D4 SDK lint (greenBy: D) — "SDK lint steers toward the taught path" ───

async function testSdkLint(): Promise<void> {
  await test('D §sdk-lint: a raw setTimeout(fn, …) is a warning naming delay/interval', { greenBy: 'D' }, () => {
    const src = 'setTimeout(() => {}, 1000);\n';
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'raw_timer');
    assert(d.severity === 'warning', 'raw_timer must be a warning, not an error');
    assert(/delay|interval/.test(d.hint), `hint should name delay/interval, got: ${d.hint}`);
  });

  await test('D §diagnostics: a warning alone still fails ok (harness-diagnostics req 3)', { greenBy: 'D' }, () => {
    const r = runStaticChecks('setTimeout(() => {}, 1000);\n');
    assert(r.diagnostics.every((d) => d.severity !== 'error'), 'this fixture should produce only a warning, no error, to isolate the assertion');
    assert(r.ok === false, 'a report with one warning and zero errors must still be ok:false — no severity-threshold knob');
  });
}

// ── §D5 schema check (greenBy: D) — reuses the storage engine's pure functions ──

async function testSchemaCheck(): Promise<void> {
  const APPLIED_ONE_TEXT_FIELD: AppliedSchema = {
    collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [] }],
  };
  const INCOMING_TYPE_CHANGE: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'int' } } } },
  };

  await test('D §schema: a generation-time type_change conflict is caught before any run, hint matches the engine verbatim', { greenBy: 'D' }, () => {
    const engineDiff = diffSchemas(APPLIED_ONE_TEXT_FIELD, INCOMING_TYPE_CHANGE);
    assert(engineDiff.kind === 'conflict', 'test setup error: expected the engine itself to see this as a conflict');
    const engineHint = engineDiff.kind === 'conflict' ? engineDiff.errors.find((e) => e.kind === 'type_change')?.hint : undefined;
    assert(!!engineHint, 'test setup error: expected the engine to produce a type_change error');

    const src = schemaAppSource('int', true);
    const r = runStaticChecks(src, { appliedSchema: APPLIED_ONE_TEXT_FIELD });
    const d = assertHasKind(r, 'type_change');
    assert(d.hint === engineHint, `checker hint must match the engine's fix hint verbatim; got "${d.hint}" vs engine "${engineHint}"`);
  });

  await test('D §schema: first generation (no applied schema) validates shape only — no schema diagnostics', { greenBy: 'D' }, () => {
    const src = schemaAppSource('text', true);
    const r = runStaticChecks(src);
    const schemaKinds: DiagnosticKind[] = [
      'invalid_artifact', 'malformed_id', 'id_reuse', 'bad_field_type', 'bad_default',
      'type_change', 'tombstone_violation', 'missing_default',
    ];
    for (const k of schemaKinds) assertNoKind(r, k, `no ${k} expected on a well-formed first-generation schema`);
  });

  await test('D §schema: validateArtifact kinds surface verbatim on a malformed schema literal', { greenBy: 'D' }, () => {
    const src = schemaAppSource('not-a-real-type');
    const r = runStaticChecks(src);
    assertHasKind(r, 'bad_field_type');
  });
}

// ── §E1 assembly: ordering / purity / determinism (greenBy: E) ─────────────

async function testAssemblyOrderingPurity(): Promise<void> {
  await test('E §assembly: independent passes accumulate (only the parse gate short-circuits)', { greenBy: 'E' }, () => {
    const src = `
import x from 'lodash';
fetch('http://evil.example');
`;
    const r = runStaticChecks(src);
    assertHasKind(r, 'disallowed_import');
    assertHasKind(r, 'forbidden_global');
  });

  // A single source that trips FOUR diagnostics out of FOUR different passes (import-allowlist,
  // forbidden-globals, screen-graph, sdk-lint) — used below to prove both stable pass-order
  // assembly and non-trivial purity (an empty-diagnostics fixture would make a JSON.stringify
  // equality check vacuously true).
  const MULTI_PASS_SRC = `
import bad from 'lodash';
import { defineApp } from 'vc-sdk';
function Home() { return null; }
fetch('http://evil.example');
setTimeout(() => {}, 1000);
export default defineApp({
  name: 'T', initial: 'Nope', screens: { Home }, capabilities: [],
});
`;

  await test('E §assembly: diagnostics from independent passes appear in PASSES declaration order, not source order', { greenBy: 'E' }, () => {
    const r = runStaticChecks(MULTI_PASS_SRC);
    // Source order would put forbidden_global (line 5) before unresolved_screen (line 8) before
    // raw_timer (line 6) — but PASSES order is import-allowlist, forbidden-globals, ...,
    // screen-graph, sdk-lint, so the report order is disallowed_import, forbidden_global,
    // unresolved_screen, raw_timer regardless of where each offense sits in the source text.
    assert(
      JSON.stringify(kindsOf(r)) === JSON.stringify(['disallowed_import', 'forbidden_global', 'unresolved_screen', 'raw_timer']),
      `expected assembly order [disallowed_import, forbidden_global, unresolved_screen, raw_timer], got [${kindsOf(r).join(', ')}]`,
    );
  });

  await test('E §purity: the same source checked twice (any order) yields deeply-equal, non-trivial reports', { greenBy: 'E' }, () => {
    const r1 = runStaticChecks(MULTI_PASS_SRC);
    const r2 = runStaticChecks(MULTI_PASS_SRC);
    assert(r1.diagnostics.length > 1, 'purity fixture must produce more than one diagnostic — an empty-array comparison would be vacuous');
    assert(JSON.stringify(r1) === JSON.stringify(r2), 'two checks of the identical source must produce deeply-equal reports');
  });

  await test('E §purity: a hostile top-level side effect is never observed — the checker never executes the source', { greenBy: 'E' }, () => {
    const sentinelKey = '__checksAcceptanceSentinel__';
    (globalThis as Record<string, unknown>)[sentinelKey] = false;
    const src = `(globalThis as any).${sentinelKey} = true;\nthrow new Error('this must never run');\n`;
    runStaticChecks(src);
    assert((globalThis as Record<string, unknown>)[sentinelKey] === false, 'checking hostile source must never execute it — the sentinel must remain false');
  });
}

// ── §E2 honest fixtures + latency-probe pinned expected-flagged (greenBy: E) ──

async function testHonestFixturesAndLatencyProbe(): Promise<void> {
  const HONEST_FIXTURES = ['tip-splitter.app.tsx', 'water-counter.app.tsx', 'pour-over-timer.app.tsx', 'style-gallery.app.tsx'];

  await test('E §honest-corpus: every real honest fixture is ok with zero diagnostics', { greenBy: 'E' }, () => {
    for (const name of HONEST_FIXTURES) {
      const src = readFixture(name);
      const r = runStaticChecks(src);
      assert(r.ok === true, `fixture ${name} should be ok, got diagnostics: ${JSON.stringify(r.diagnostics)}`);
      assert(r.diagnostics.length === 0, `fixture ${name} should have zero diagnostics, got ${r.diagnostics.length}`);
    }
  });

  // Corpus-shaped honest samples (spec "Honest code produces zero diagnostics" — the honest
  // population is the real fixtures PLUS corpus-shaped samples, task 7.2). These are inline,
  // not files under `fixtures/`, so they can cover shapes the five real apps don't: a
  // multi-screen manifest (a declared-but-not-`initial` screen must not be flagged), a
  // combined storage+cues app whose schema exercises all six closed field types, and an
  // SDK-timers app (`delay`/`interval`, not raw `setTimeout`) with try/finally control flow.
  const CORPUS_SAMPLES: Record<string, string> = {
    'multi-screen, zero-capability': `
import { defineApp, Screen, Stack, Row, Heading, Text, Button, useState, Card, Divider, Badge } from 'vc-sdk';

function Home() {
  const [count, setCount] = useState(0);
  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Corpus Sample</Heading>
        <Card>
          <Row gap="sm">
            <Text>Count</Text>
            <Badge>{String(count)}</Badge>
          </Row>
        </Card>
        <Divider />
        <Button label="Increment" onPress={() => setCount((c) => c + 1)} />
      </Stack>
    </Screen>
  );
}

function About() {
  return (
    <Screen padding="lg">
      <Stack gap="md">
        <Heading size="subtitle">About</Heading>
        <Text color="text-muted">A second, unreferenced screen — declared but not the initial.</Text>
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Corpus Multi-Screen',
  initial: 'Home',
  screens: { Home, About },
  capabilities: [],
});
`,
    'storage+cues combined, all six field types': `
import {
  defineApp, Screen, Stack, Heading, Text, Button, useState, useEffect,
  storage, cues, type SchemaArtifact,
} from 'vc-sdk';

const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Entries: {
      id: 'c1',
      tombstones: [],
      fields: {
        title: { id: 'f1', type: 'text' },
        count: { id: 'f2', type: 'int' },
        ratio: { id: 'f3', type: 'float' },
        done: { id: 'f4', type: 'bool' },
        at: { id: 'f5', type: 'date' },
        meta: { id: 'f6', type: 'json' },
      },
    },
  },
};

function Home() {
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    storage.records.list('Entries').then(() => setStatus('loaded')).catch(() => setStatus('error'));
  }, []);

  const addEntry = async () => {
    await storage.records.append('Entries', { title: 'x', count: 1, ratio: 0.5, done: true, at: Date.now(), meta: {} });
    cues.haptic('tap');
    cues.sound('tick');
  };

  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Corpus Storage+Cues</Heading>
        <Text color="text-muted">{status}</Text>
        <Button label="Add" onPress={addEntry} />
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Corpus Storage Cues',
  initial: 'Home',
  screens: { Home },
  capabilities: ['storage', 'cues'],
  schema: SCHEMA,
});
`,
    'SDK timers (delay/interval), not raw setTimeout': `
import { defineApp, Screen, Stack, Heading, Text, Button, useState, delay, interval } from 'vc-sdk';

function Home() {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  interval(() => setTick((t) => t + 1), 1000);

  const runOnce = async () => {
    setBusy(true);
    try {
      await delay(500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Corpus Timers</Heading>
        <Text>{\`tick: \${tick}\`}</Text>
        <Button label={busy ? 'Working…' : 'Run'} onPress={runOnce} />
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Corpus Timers',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
});
`,
  };

  await test('E §honest-corpus: corpus-shaped synthetic samples are ok with zero diagnostics', { greenBy: 'E' }, () => {
    for (const [label, src] of Object.entries(CORPUS_SAMPLES)) {
      const r = runStaticChecks(src);
      assert(r.ok === true, `corpus sample "${label}" should be ok, got diagnostics: ${JSON.stringify(r.diagnostics)}`);
      assert(r.diagnostics.length === 0, `corpus sample "${label}" should have zero diagnostics, got ${r.diagnostics.length}`);
    }
  });

  await test('E §honest-corpus: latency-probe is pinned expected-flagged (raw __whimSyscall + facade-less diag), never in the honest set', { greenBy: 'E' }, () => {
    const src = readFixture('latency-probe.app.tsx');
    const r = runStaticChecks(src);
    assert(r.ok === false, 'latency-probe must NOT be zero-diagnostics — it deliberately bypasses the SDK');
    assertHasKind(r, 'forbidden_global', 'latency-probe reaches globalThis.__whimSyscall directly — a forbidden-global violation');
    assertHasKind(r, 'unused_capability', 'the diag capability has no SDK facade, so declaring it always draws unused_capability');
  });
}

// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  await testContractAndHarnessSelfTests();
  await testParseGate();
  await testImportAllowlist();
  await testForbiddenGlobalsWalk();
  await testManifestExtraction();
  await testCapabilityDirections();
  await testScreenGraph();
  await testSdkLint();
  await testSchemaCheck();
  await testAssemblyOrderingPurity();
  await testHonestFixturesAndLatencyProbe();
  await runHostileCorpus();
}

main()
  .then(() => {
    const { exitCode } = report();
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error('static-checks acceptance suite crashed:', err);
    process.exit(1);
  });
