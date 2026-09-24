/**
 * Node acceptance for the static-check pipeline (design D8/D9).
 *
 * Black-box style throughout (design D8): every scenario test drives `runStaticChecks(source,
 * opts)` and reads the returned `CheckReport` — never a pass-internal function. Individual
 * pass internals (if any chain adds them) are documented in `handoff/checker-internals.md`
 * (Chain C), not depended on here.
 *
 * Sections (one function per section below, run in order by `main()`):
 *   §B0  contract.ts
 *   §B1  storage-surface scanner (one scanner, two consumers)
 *   §C1  parse gate
 *   §C2  import allowlist
 *   §C3  forbidden-global walk (T8) + shadowing + no-suppression
 *   §D1  manifest extraction
 *   §D2  capability declarations ⇄ use, both directions
 *   §D3  screen graph
 *   §D4  SDK lint
 *   §D5  schema check (validate + diff)
 *   §schema identity  edit continuity: burned IDs survive a rewrite
 *   §storage continuity  edit continuity: reads survive a rewrite
 *   §E1  assembly: ordering / purity / determinism
 *   §E2  honest fixtures (zero-diagnostics)
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, report, assert, assertHasKind, assertNoKind, findByKind } from './harness';
import { runHostileCorpus } from './hostile/corpus';
import { runReleaseSuites } from './release';
import { run as runSourceScans } from './repo/source-scans.suite';
import { run as runHeaderLockstep } from './repo/header-lockstep.suite';
import {
  CheckReport,
  DIAGNOSTIC_KINDS,
  DiagnosticKind,
  FORBIDDEN_DIRECT_NAMES,
  GLOBAL_ROOTS,
  SDK_LINT_RULES,
} from '../contract';
import { runStaticChecks as runStaticChecksRaw, scanStorageSurface, StorageSurface } from '../index';
// Value import (the roster array only — `observe.ts`'s own imports are all type-only, so this
// pulls no Playwright/runtime dependency into the Node bundle).
import { AppliedSchema, diffSchemas } from '../../src/host/storage-engine/schema';
import { SchemaArtifact, STORAGE_ERROR_KINDS } from '../../src/host/storage-engine/contract';
import { UNDECLARED_CAPABILITY_KIND } from '../../src/host/bridge/contract';

/** Every diagnostic in the report is well-formed per harness-diagnostics req 1/2. */
function assertAllWellFormed(r: CheckReport): void {
  for (const d of r.diagnostics) {
    assert((DIAGNOSTIC_KINDS as readonly string[]).includes(d.kind), `diagnostic kind "${d.kind}" is not in the closed DIAGNOSTIC_KINDS union`);
    assert(d.severity === 'error' || d.severity === 'warning', `diagnostic severity must be 'error'|'warning', got ${String(d.severity)}`);
    assert(typeof d.hint === 'string' && d.hint.trim().length > 0, `diagnostic ${d.kind} has no non-empty hint (mandatory, harness-diagnostics req 1)`);
    assert(Number.isInteger(d.line) && d.line >= 1, `diagnostic ${d.kind} must carry a 1-based line, got ${String(d.line)}`);
  }
}

/** Every scenario in this suite runs its report through `assertAllWellFormed` — not just one hint test. */
function runStaticChecks(...args: Parameters<typeof runStaticChecksRaw>): CheckReport {
  const r = runStaticChecksRaw(...args);
  assertAllWellFormed(r);
  return r;
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

/** A schema-declaring app source with one `Notes` collection whose fields are exactly the
 *  given `{displayName: {id, default?}}` map (all `text`-typed — the id/floor logic under
 *  test is type-agnostic). Used by the allocation-floor tests (§D5), which need multiple
 *  fields at specific burned IDs rather than the single-field `schemaAppSource` above. */
function schemaFieldEntry(name: string, spec: { id: string; default?: string }): string {
  const defaultPart = spec.default !== undefined ? `, default: '${spec.default}'` : '';
  return `${name}: { id: '${spec.id}', type: 'text'${defaultPart} }`;
}

function schemaAppSourceFields(fields: Record<string, { id: string; default?: string }>, collectionId = 'c1'): string {
  const fieldEntries = Object.entries(fields)
    .map(([name, spec]) => schemaFieldEntry(name, spec))
    .join(', ');
  return `
import { defineApp, type SchemaArtifact } from 'vc-sdk';
function Home() { return null; }
const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: '${collectionId}', tombstones: [], fields: { ${fieldEntries} } } },
};
export default defineApp({
  name: 'T', initial: 'Home', screens: { Home }, capabilities: [], schema: SCHEMA,
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

// ── §B0 contract.ts ──────────────────────

async function testContractAndHarnessSelfTests(): Promise<void> {

  await test('contract: the storage engine\'s VERB-TIME kinds are carried under the engine\'s own names', () => {
    // checks/test is excluded from tsconfig.json, so esbuild strips types unchecked here — a
    // type-level intersection would be imaginary safety. Read the engine's own runtime array
    // instead: every VERB-TIME kind (HOST-FAULT `not_open`/`corrupt_storage` excluded — those
    // name the harness's own engine state, not a candidate mistake) must be a diagnostic kind.
    const hostFault = new Set(['not_open', 'corrupt_storage']);
    const verbTimeKinds = new Set(['type_mismatch', 'unknown_collection', 'unknown_field', 'unknown_record', 'unqueryable_field', 'kv_too_large']);
    const verbTime = STORAGE_ERROR_KINDS.filter((k) => !hostFault.has(k) && verbTimeKinds.has(k));
    assert(verbTime.length === verbTimeKinds.size, `expected ${verbTimeKinds.size} verb-time kinds from the engine, got ${verbTime.length}`);
    for (const k of verbTime) {
      assert((DIAGNOSTIC_KINDS as readonly string[]).includes(k), `DIAGNOSTIC_KINDS is missing verb-time storage kind "${k}"`);
    }
  });
}

// ── §B1 storage-surface scanner ───────────────────────────────
// generation-pipeline req "The storage-surface instruction and the drift check read one
// scanner". Driven through the PUBLIC entry (`checks/index.ts`) — that re-export is what the
// generation server imports, so reaching into the module directly would not prove it exists.

/** The 1-based (line, column) the scanner reported must point at `token` in `src`. */
function assertAnchors(src: string, at: { line: number; column: number }, token: string, what: string): void {
  const line = src.split('\n')[at.line - 1];
  assert(line !== undefined, `${what}: line ${at.line} is past the end of the source`);
  assert(
    (line as string).slice(at.column - 1).startsWith(token),
    `${what}: expected (${at.line},${at.column}) to point at ${token}, but the source there is ${JSON.stringify((line as string).slice(at.column - 1, at.column + 20))}`,
  );
}

async function testStorageSurfaceScanner(): Promise<void> {
  await test('storage-surface: literal kv keys are collected with their method and anchor', () => {
    const src = [
      "import { storage } from 'vc-sdk';",
      "const load = () => storage.kv.get('habitCompletionHistory');",
      "const save = (v: number) => storage.kv.set('total', v);",
    ].join('\n');
    const surface = scanStorageSurface(src);
    const names = surface.kvKeys.map((k) => k.name);
    assert(
      JSON.stringify(names) === JSON.stringify(['habitCompletionHistory', 'total']),
      `expected kv keys [habitCompletionHistory, total] in source order, got [${names.join(', ')}]`,
    );
    assert(surface.kvKeys[0]?.method === 'get', `expected the first key's method 'get', got ${String(surface.kvKeys[0]?.method)}`);
    assert(surface.kvKeys[1]?.method === 'set', `expected the second key's method 'set', got ${String(surface.kvKeys[1]?.method)}`);
    assertAnchors(src, surface.kvKeys[0] as { line: number; column: number }, "'habitCompletionHistory'", 'kv key anchor');
    assert(surface.collections.length === 0, 'a kv-only source names no collections');
    assert(surface.dynamic.length === 0, 'every argument was a literal — nothing dynamic');
  });

  await test('storage-surface: literal record collections are collected, deduplicated, in source order', () => {
    const src = [
      "import { storage } from 'vc-sdk';",
      "const add = () => storage.records.append('Completions', { done: 1 });",
      "const all = () => storage.records.list('Completions');",
      "const streaks = () => storage.records.list('Streaks');",
    ].join('\n');
    const surface = scanStorageSurface(src);
    const names = surface.collections.map((c) => c.name);
    assert(
      JSON.stringify(names) === JSON.stringify(['Completions', 'Streaks']),
      `expected collections [Completions, Streaks] (deduplicated, source order), got [${names.join(', ')}]`,
    );
    assert(
      surface.collections[0]?.line === 2 && surface.collections[0]?.method === 'append',
      `the deduplicated entry keeps the FIRST occurrence (line 2, method append), got ${JSON.stringify(surface.collections[0])}`,
    );
    assert(surface.kvKeys.length === 0, 'a records-only source names no kv keys');
  });

  await test('storage-surface: a computed argument is recorded as a dynamic site, not as a name', () => {
    const src = [
      "import { storage } from 'vc-sdk';",
      'const key = (d: string) => `day-${d}`;',
      'const read = (d: string) => storage.kv.get(key(d));',
      'const rows = (c: string) => storage.records.list(c);',
    ].join('\n');
    const surface = scanStorageSurface(src);
    assert(surface.kvKeys.length === 0, `a computed key names nothing, got [${surface.kvKeys.map((k) => k.name).join(', ')}]`);
    assert(surface.collections.length === 0, `a computed collection names nothing, got [${surface.collections.map((c) => c.name).join(', ')}]`);
    assert(surface.dynamic.length === 2, `expected one dynamic site per non-literal argument (2), got ${surface.dynamic.length}`);
    const sites = surface.dynamic.map((d) => `${d.facade}.${d.method}`);
    assert(
      JSON.stringify(sites) === JSON.stringify(['kv.get', 'records.list']),
      `each dynamic site names its facade and method — expected [kv.get, records.list], got [${sites.join(', ')}]`,
    );
    assertAnchors(src, surface.dynamic[0] as { line: number; column: number }, 'key(d)', 'dynamic kv site anchor');
    assertAnchors(src, surface.dynamic[1] as { line: number; column: number }, 'c)', 'dynamic records site anchor');
  });

  await test('storage-surface: a substitution-free template is a literal; an interpolated one is dynamic', () => {
    const surface = scanStorageSurface(
      [
        "import { storage } from 'vc-sdk';",
        'const a = () => storage.kv.get(`total`);',
        'const b = (d: string) => storage.kv.get(`day-${d}`);',
      ].join('\n'),
    );
    assert(
      surface.kvKeys.length === 1 && surface.kvKeys[0]?.name === 'total',
      `the substitution-free template names 'total', got [${surface.kvKeys.map((k) => k.name).join(', ')}]`,
    );
    assert(surface.dynamic.length === 1, `the interpolated template names no provable key — expected 1 dynamic site, got ${surface.dynamic.length}`);
  });

  await test('storage-surface: a `storage` that is not the vc-sdk import is never collected (binding resolution, not token matching)', () => {
    const shadowed = scanStorageSurface(
      ["const storage = { kv: { get: (k: string) => k } };", "const read = () => storage.kv.get('total');"].join('\n'),
    );
    assert(
      shadowed.kvKeys.length === 0,
      `a local object named storage is not the SDK facade, got [${shadowed.kvKeys.map((k) => k.name).join(', ')}]`,
    );
    const otherModule = scanStorageSurface(["import { storage } from 'other';", "const read = () => storage.kv.get('total');"].join('\n'));
    assert(otherModule.kvKeys.length === 0, 'an import of `storage` from another module is not the SDK facade either');
  });

  await test('storage-surface: the namespace-import form resolves too', () => {
    const surface = scanStorageSurface(
      ["import * as sdk from 'vc-sdk';", "const read = () => sdk.storage.records.list('Notes');"].join('\n'),
    );
    const names = surface.collections.map((c) => c.name);
    assert(JSON.stringify(names) === JSON.stringify(['Notes']), `expected [Notes] via the namespace import, got [${names.join(', ')}]`);
  });

  await test('storage-surface: a source with no storage use yields an empty surface', () => {
    const surface: StorageSurface = scanStorageSurface(appSource('[]'));
    assert(
      surface.kvKeys.length === 0 && surface.collections.length === 0 && surface.dynamic.length === 0,
      `expected an empty surface, got ${JSON.stringify(surface)}`,
    );
  });
}

// ── §C1 parse gate — "Parse gate runs first and alone" ────────

async function testParseGate(): Promise<void> {
  await test('parse: a syntax error short-circuits — only parse_error diagnostics, at the offending line', () => {
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

// ── §C2 import allowlist — "Imports resolve only to vc-sdk" ───

async function testImportAllowlist(): Promise<void> {
  await test('imports: off-allowlist static specifiers are rejected, naming the specifier', () => {
    for (const specifier of ['lodash', 'react', 'react/jsx-runtime', './local', 'vc-sdk/ui']) {
      const src = `import x from '${specifier}';\n`;
      const r = runStaticChecks(src);
      const d = assertHasKind(r, 'disallowed_import', `no disallowed_import for specifier "${specifier}"`);
      assert(d.symbol === specifier, `expected symbol "${specifier}", got "${String(d.symbol)}"`);
      assert(/vc-sdk/.test(d.hint), `hint should point at vc-sdk for specifier "${specifier}", got: ${d.hint}`);
    }
  });

  await test('imports: require(...) is rejected with a hint naming vc-sdk', () => {
    const src = "const x = require('vc-sdk');\n";
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'disallowed_import');
    assert(/vc-sdk/.test(d.hint), `hint should name vc-sdk, got: ${d.hint}`);
  });

  await test('imports: dynamic import() is rejected regardless of specifier', () => {
    const src = "async function boot() { await import('vc-sdk'); }\n";
    const r = runStaticChecks(src);
    assertHasKind(r, 'disallowed_import', 'dynamic import() must be rejected even when the specifier is on-allowlist');
  });

  // Spec "A re-export of a file path is rejected". `ok === false` is the check stage's refusal: the
  // pipeline builds only a candidate whose report is ok, so this one never reaches the build stage.
  await test('imports: a re-export of a file path is rejected, naming the specifier', () => {
    const reExports: [string, string][] = [
      ["export * from '/etc/hosts';\n", '/etc/hosts'],
      ["export { x } from '../../server/src/main';\n", '../../server/src/main'],
    ];
    for (const [src, specifier] of reExports) {
      const r = runStaticChecks(src);
      const d = assertHasKind(r, 'disallowed_import', `no disallowed_import for the re-export of "${specifier}"`);
      assert(d.symbol === specifier, `expected symbol "${specifier}", got "${String(d.symbol)}"`);
      assert(d.severity === 'error', `a re-export of a file path must be an error, got ${d.severity}`);
      assert(/vc-sdk/.test(d.hint), `hint should point at vc-sdk for "${specifier}", got: ${d.hint}`);
      assert(r.ok === false, `a candidate re-exporting "${specifier}" must not pass the check stage`);
    }
  });

  // Spec "An import-equals require is rejected".
  await test('imports: an import-equals require is rejected, naming the specifier', () => {
    const r = runStaticChecks("import cfg = require('./config.json');\n");
    const d = assertHasKind(r, 'disallowed_import', 'no disallowed_import for an import-equals require');
    assert(d.symbol === './config.json', `expected symbol "./config.json", got "${String(d.symbol)}"`);
    assert(d.severity === 'error', `an import-equals require must be an error, got ${d.severity}`);
  });

  // Non-vacuity for the two cases above: the same positions naming `vc-sdk` draw nothing, so the
  // pass reads the specifier in each position rather than refusing the syntax wholesale.
  await test('imports: re-export and import-equals forms naming vc-sdk are not flagged', () => {
    for (const src of ["export { Screen } from 'vc-sdk';\n", "export * from 'vc-sdk';\n", "import sdk = require('vc-sdk');\n"]) {
      assertNoKind(runStaticChecks(src), 'disallowed_import', `"${src.trim()}" names only vc-sdk and must not be flagged`);
    }
  });
}

// ── §C3 forbidden-global walk — "Forbidden-global walk closes T8" ──

async function testForbiddenGlobalsWalk(): Promise<void> {
  // The names the sandbox must never hand a mini-app: codegen, the DOM root, and the runtime's
  // neutralize list (network, ambient persistence, threads). Written out here, not read from the
  // checker's own table, so dropping a name from the table fails this test. Names the table adds
  // later are exercised too.
  const mustFlag = new Set([
    'eval', 'Function', 'document',
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection',
    'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'Worker', 'SharedWorker',
    ...FORBIDDEN_DIRECT_NAMES,
  ]);
  const roots = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames', ...GLOBAL_ROOTS]);

  await test('globals: every forbidden name is flagged as a bare reference and through every global root', () => {
    for (const name of mustFlag) {
      for (const src of [`const r = ${name};\nvoid r;\n`, ...[...roots].map((root) => `const r = ${root}.${name};\nvoid r;\n`)]) {
        assertHasKind(runStaticChecks(src), 'forbidden_global', `expected forbidden_global for ${JSON.stringify(src)}`);
      }
    }
  });

  await test('globals: every global root is flagged when read directly', () => {
    for (const root of roots) {
      assertHasKind(runStaticChecks(`const r = ${root}.whatever;\nvoid r;\n`), 'forbidden_global', `expected forbidden_global for ${root}.whatever`);
    }
  });

  await test('globals: a parameter that shadows a forbidden name or root is never flagged', () => {
    // `eval` can't be a binding name in a module (strict mode), so it has no shadowing case.
    for (const name of [...mustFlag, ...roots].filter((n) => n !== 'eval')) {
      const src = `function f(${name}: string): string {\n  return ${name} + '!';\n}\nf('a');\n`;
      assertNoKind(runStaticChecks(src), 'forbidden_global', `a parameter named ${name} must not be flagged`);
    }
  });

  await test('globals: direct reference to a forbidden name is flagged', () => {
    const r = runStaticChecks("fetch('http://evil.example');\n");
    assertHasKind(r, 'forbidden_global');
  });

  await test('globals: bare reference to a global root is itself flagged', () => {
    const r = runStaticChecks('const x = globalThis;\nvoid x;\n');
    assertHasKind(r, 'forbidden_global');
  });

  await test('globals: member access through an alias is flagged (taint follows lexical assignment)', () => {
    const r = runStaticChecks("const g = globalThis;\nconst h = g;\nh.fetch('x');\n");
    assertHasKind(r, 'forbidden_global');
  });

  await test('globals: .constructor access is flagged (prototype-walk codegen)', () => {
    const r = runStaticChecks("({}).constructor.constructor('return 1')();\n");
    assertHasKind(r, 'forbidden_global');
  });

  await test('globals: string-argument setTimeout/setInterval is flagged as implicit eval', () => {
    const r = runStaticChecks("setTimeout('doEvil()', 1000);\n");
    assertHasKind(r, 'implicit_eval');
  });

  await test('globals: honest shadowing (a local binding named like a forbidden global) is NOT flagged', () => {
    const src = "function f(fetch: string): string {\n  return fetch + '!';\n}\nf('a');\n";
    const r = runStaticChecks(src);
    assertNoKind(r, 'forbidden_global', 'a parameter named "fetch", used only as a plain local value, must not be flagged');
  });

  await test('globals: no inline pragma suppresses a diagnostic (harness-diagnostics req 4)', () => {
    const src = "// whim-disable-next-line forbidden-global\nfetch('http://evil.example');\n";
    const r = runStaticChecks(src);
    assertHasKind(r, 'forbidden_global', 'a disable-style comment pragma must not suppress the diagnostic — there is no suppression mechanism');
  });
}

// ── §D1 manifest extraction — "app manifest is extracted statically" ──

async function testManifestExtraction(): Promise<void> {
  await test('manifest: computed capabilities are rejected (identifier indirection and string-built elements)', () => {
    const identifierSrc = appSource('someArray', 'defineApp', 'return null;', "const someArray = ['storage'];");
    const r1 = runStaticChecks(identifierSrc);
    const d1 = assertHasKind(r1, 'manifest_not_static');
    assert(/literal/i.test(d1.hint), `hint should require a literal array, got: ${d1.hint}`);

    const concatSrc = appSource("['sto' + 'rage']");
    const r2 = runStaticChecks(concatSrc);
    assertHasKind(r2, 'manifest_not_static');
  });

  await test('manifest: extraction survives a later failure — the report still carries the manifest', () => {
    const src = appSource('[]', 'defineApp', 'return null;', "fetch('http://evil.example');", 'Honest Name');
    const r = runStaticChecks(src);
    assert(r.ok === false, 'the forbidden-global violation must still fail the report');
    assert(!!r.manifest, 'the manifest must be present even though the report is failing');
    assert(r.manifest?.name === 'Honest Name', `expected manifest.name "Honest Name", got ${String(r.manifest?.name)}`);
    assert(r.manifest?.initial === 'Home', `expected manifest.initial "Home", got ${String(r.manifest?.initial)}`);
  });
}

// ── §D2 capability directions ──────────────────────────────────

async function testCapabilityDirections(): Promise<void> {
  await test('capabilities: the static undeclared_capability kind matches the bridge gate\'s own denial-kind constant', () => {
    assert(
      (DIAGNOSTIC_KINDS as readonly string[]).includes(UNDECLARED_CAPABILITY_KIND),
      `DIAGNOSTIC_KINDS is missing "${UNDECLARED_CAPABILITY_KIND}", the kind gate.ts actually returns for a denied capability`,
    );
  });

  await test('capabilities: used but undeclared → undeclared_capability error naming the capability (matches the bridge gate kind)', () => {
    const src = appSource('[]', 'defineApp, storage', 'return null;', "storage.kv.set('k', 1);");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'undeclared_capability');
    assert(d.severity === 'error', 'undeclared_capability must be an error (the runtime gate would deny it)');
    assert(d.symbol === 'storage', `expected symbol "storage", got "${String(d.symbol)}"`);
    assert(/capabilities/.test(d.hint), `hint should show the corrected capabilities array, got: ${d.hint}`);
  });

  await test('capabilities: declared but unused → unused_capability warning naming the capability', () => {
    const src = appSource("['storage']");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'unused_capability');
    assert(d.severity === 'warning', 'unused_capability must be a warning (§5.4 — the consent sheet must not list ghosts)');
    assert(d.symbol === 'storage', `expected symbol "storage", got "${String(d.symbol)}"`);
  });

  // ── §D2b capability shadow guard (reviewer capfix Finding 1/3) — a root
  // identifier only counts as SDK-export use when it resolves to the `vc-sdk` import, not by
  // root-identifier-TEXT matching alone (a local shadow of the same name must not count).

  await test('capabilities: a local shadow of an imported-but-unused SDK export is NOT counted as use — no false-positive undeclared_capability', () => {
    const src = appSource('[]', 'defineApp, storage', "const storage = { value: 'not the SDK' };\n  return storage.value;");
    const r = runStaticChecks(src);
    assertNoKind(r, 'undeclared_capability', 'a local const "storage" shadowing the (unused) vc-sdk import must not be treated as SDK use');
  });

  await test('capabilities: a declared capability whose only "storage" reference is a local shadow still draws unused_capability — the shadow must not mask it', () => {
    const src = appSource("['storage']", 'defineApp, storage', "const storage = { value: 'not the SDK' };\n  return storage.value;");
    const r = runStaticChecks(src);
    const d = assertHasKind(r, 'unused_capability', 'the shadow must not suppress the genuinely-unused "storage" capability warning');
    assert(d.symbol === 'storage', `expected symbol "storage", got "${String(d.symbol)}"`);
  });

  await test('manifest: two default-exported defineApp calls draw a manifest_not_static diagnostic (duplicate lock-in)', () => {
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

// ── §D3 screen graph — "Screen graph resolves statically" ─────

async function testScreenGraph(): Promise<void> {
  await test('screens: unresolvable initial produces an error listing the declared screens', () => {
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

  await test('screens: direct, aliased, and namespace nav import all reject a dangling or a non-literal target', () => {
    const spellings = {
      direct: { imports: "import { defineApp, nav } from 'vc-sdk';", call: (target: string) => `nav.navigate(${target});` },
      aliased: { imports: "import { defineApp, nav as router } from 'vc-sdk';", call: (target: string) => `router.navigate(${target});` },
      namespace: {
        imports: "import { defineApp } from 'vc-sdk';\nimport * as sdk from 'vc-sdk';",
        call: (target: string) => `sdk.nav.navigate(${target});`,
      },
    };
    const targets = {
      dangling: { arg: "'Settings'", extraDecl: '' },
      'non-literal': { arg: 'screenVar', extraDecl: "const screenVar = 'Home';\n  " },
    };

    for (const [label, spelling] of Object.entries(spellings)) {
      for (const [targetLabel, target] of Object.entries(targets)) {
        const src = `
${spelling.imports}
function Home() {
  ${target.extraDecl}${spelling.call(target.arg)}
  return null;
}
export default defineApp({
  name: 'T', initial: 'Home', screens: { Home }, capabilities: [],
});
`;
        const r = runStaticChecks(src);
        const d = assertHasKind(r, 'unresolved_screen');
        assert(/Home/.test(d.hint), `${label}/${targetLabel}: hint should list the declared screens (Home), got: ${d.hint}`);
        if (targetLabel === 'dangling') {
          assert(d.symbol === 'Settings', `${label}/dangling: expected the diagnostic to name "Settings", got ${String(d.symbol)}`);
        } else {
          assert(/string literal/i.test(d.message), `${label}/non-literal: message should require a string literal, got: ${d.message}`);
        }
      }
    }
  });

  await test('screens: direct, aliased, and namespace vc-sdk navigation accept a declared literal target', () => {
    const spellings = {
      direct: {
        imports: "import { defineApp, nav } from 'vc-sdk';",
        call: "nav.navigate('Settings');",
      },
      aliased: {
        imports: "import { defineApp, nav as router } from 'vc-sdk';",
        call: "router.navigate('Settings');",
      },
      namespace: {
        imports: "import { defineApp } from 'vc-sdk';\nimport * as sdk from 'vc-sdk';",
        call: "sdk.nav.navigate('Settings');",
      },
    };

    for (const [label, spelling] of Object.entries(spellings)) {
      const src = `
${spelling.imports}
function Home() {
  ${spelling.call}
  return null;
}
function Settings() { return null; }
export default defineApp({
  name: 'T', initial: 'Home', screens: { Home, Settings }, capabilities: [],
});
`;
      const r = runStaticChecks(src);
      assertNoKind(r, 'unresolved_screen', `${label} vc-sdk navigation to a declared screen must resolve`);
    }
  });

  await test('screens: unrelated, local, and shadowed nav bindings are not SDK navigation', () => {
    const sources = {
      unrelated: `
import { defineApp } from 'vc-sdk';
import { nav } from './unrelated';
function Home() { nav.navigate('Missing'); return null; }
export default defineApp({ name: 'T', initial: 'Home', screens: { Home }, capabilities: [] });
`,
      local: `
import { defineApp } from 'vc-sdk';
const nav = { navigate(_target: string) {} };
function Home() { nav.navigate('Missing'); return null; }
export default defineApp({ name: 'T', initial: 'Home', screens: { Home }, capabilities: [] });
`,
      shadowed: `
import { defineApp, nav } from 'vc-sdk';
function Home(nav: { navigate(target: string): void }) { nav.navigate('Missing'); return null; }
export default defineApp({ name: 'T', initial: 'Home', screens: { Home }, capabilities: [] });
`,
    };

    const falselyFlagged = Object.entries(sources)
      .filter(([, src]) => runStaticChecks(src).diagnostics.some((d) => d.kind === 'unresolved_screen'))
      .map(([label]) => label);
    assert(falselyFlagged.length === 0, `non-SDK nav bindings incorrectly flagged: [${falselyFlagged.join(', ')}]`);
  });

  await test('screens: later-declared and hoisted shadows are not mistaken for vc-sdk navigation', () => {
    const sources = {
      'later block-scoped direct nav': `
import { defineApp, nav } from 'vc-sdk';
function Home() {
  nav.navigate('Missing');
  const nav = { navigate(_target: string) {} };
  return null;
}
export default defineApp({ name: 'T', initial: 'Home', screens: { Home }, capabilities: [] });
`,
      'hoisted aliased nav': `
import { defineApp, nav as router } from 'vc-sdk';
function Home() {
  router.navigate('Missing');
  if (true) {
    var router = { navigate(_target: string) {} };
  }
  return null;
}
export default defineApp({ name: 'T', initial: 'Home', screens: { Home }, capabilities: [] });
`,
      'hoisted namespace nav': `
import { defineApp } from 'vc-sdk';
import * as sdk from 'vc-sdk';
function Home() {
  sdk.nav.navigate('Missing');
  if (true) {
    var sdk = { nav: { navigate(_target: string) {} } };
  }
  return null;
}
export default defineApp({ name: 'T', initial: 'Home', screens: { Home }, capabilities: [] });
`,
    };

    const falselyFlagged = Object.entries(sources)
      .filter(([, src]) => runStaticChecks(src).diagnostics.some((d) => d.kind === 'unresolved_screen'))
      .map(([label]) => label);
    assert(falselyFlagged.length === 0, `later-declared non-SDK nav bindings incorrectly flagged: [${falselyFlagged.join(', ')}]`);
  });
}

// ── §D4 SDK lint — "SDK lint steers toward the taught path" ───

async function testSdkLint(): Promise<void> {
  for (const rule of SDK_LINT_RULES) {
    await test(`sdk-lint: a raw ${rule.globalName}(fn, …) is a warning naming ${rule.sdkAlternative}`, () => {
      const src = `${rule.globalName}(() => {}, 1000);\n`;
      const r = runStaticChecks(src);
      const d = assertHasKind(r, 'raw_timer');
      assert(d.severity === 'warning', 'raw_timer must be a warning, not an error');
      assert(d.hint.includes(rule.sdkAlternative), `hint should name ${rule.sdkAlternative}, got: ${d.hint}`);
    });
  }

  await test('diagnostics: a warning alone still fails ok (harness-diagnostics req 3)', () => {
    const r = runStaticChecks('setTimeout(() => {}, 1000);\n');
    assert(r.diagnostics.every((d) => d.severity !== 'error'), 'this fixture should produce only a warning, no error, to isolate the assertion');
    assert(r.ok === false, 'a report with one warning and zero errors must still be ok:false — no severity-threshold knob');
  });
}

// ── §D5 schema check — reuses the storage engine's pure functions ──

async function testSchemaCheck(): Promise<void> {
  const APPLIED_ONE_TEXT_FIELD: AppliedSchema = {
    collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [] }],
  };
  const INCOMING_TYPE_CHANGE: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'int' } } } },
  };

  await test('schema: a generation-time type_change conflict is caught before any run, hint matches the engine verbatim', () => {
    const engineDiff = diffSchemas(APPLIED_ONE_TEXT_FIELD, INCOMING_TYPE_CHANGE);
    assert(engineDiff.kind === 'conflict', 'test setup error: expected the engine itself to see this as a conflict');
    const engineHint = engineDiff.kind === 'conflict' ? engineDiff.errors.find((e) => e.kind === 'type_change')?.hint : undefined;
    assert(!!engineHint, 'test setup error: expected the engine to produce a type_change error');

    const src = schemaAppSource('int', true);
    const r = runStaticChecks(src, { appliedSchema: APPLIED_ONE_TEXT_FIELD });
    const d = assertHasKind(r, 'type_change');
    assert(d.hint === engineHint, `checker hint must match the engine's fix hint verbatim; got "${d.hint}" vs engine "${engineHint}"`);
  });

  await test('schema: first generation (no applied schema) validates shape only — no schema diagnostics', () => {
    const src = schemaAppSource('text', true);
    const r = runStaticChecks(src);
    const schemaKinds: DiagnosticKind[] = [
      'invalid_artifact', 'malformed_id', 'id_reuse', 'bad_field_type', 'bad_default',
      'type_change', 'tombstone_violation', 'missing_default',
    ];
    for (const k of schemaKinds) assertNoKind(r, k, `no ${k} expected on a well-formed first-generation schema`);
  });

  await test('schema: validateArtifact kinds surface verbatim on a malformed schema literal', () => {
    const src = schemaAppSource('not-a-real-type');
    const r = runStaticChecks(src);
    assertHasKind(r, 'bad_field_type');
  });

  // ── generation-loop chain 5 (#52 D5): the monotone allocation floor ──────

  const APPLIED_GAP: AppliedSchema = {
    collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }, { id: 'f5', type: 'text' }], retired: [] }],
  };

  await test('schema: reusing a never-allocated gap below the floor is id_below_floor, naming the field and hinting the next free id', () => {
    const src = schemaAppSourceFields({ a: { id: 'f1' }, e: { id: 'f5' }, c: { id: 'f3', default: '' } }, 'c1');
    const r = runStaticChecks(src, { appliedSchema: APPLIED_GAP });
    const d = assertHasKind(r, 'id_below_floor');
    assert(d.symbol === 'f3', `expected symbol "f3", got "${String(d.symbol)}"`);
    assert(/f6/.test(d.hint), `hint should name the next free id "f6", got: ${d.hint}`);
  });

  await test('schema: a retired column still raises the floor — a tombstoned ID stays burned', () => {
    const applied: AppliedSchema = {
      collections: [{ id: 'c1', active: [{ id: 'f2', type: 'text' }], retired: [{ id: 'f9', type: 'text' }] }],
    };
    const src = schemaAppSourceFields({ b: { id: 'f2' }, e: { id: 'f5', default: '' } }, 'c1');
    const r = runStaticChecks(src, { appliedSchema: applied });
    const d = assertHasKind(r, 'id_below_floor', 'a retired field ID (f9) must still count toward the floor');
    assert(d.symbol === 'f5', `expected symbol "f5", got "${String(d.symbol)}"`);
  });

  await test('schema: an allocation above the floor is clean — no id_below_floor', () => {
    const src = schemaAppSourceFields({ a: { id: 'f1' }, e: { id: 'f5' }, g: { id: 'f6', default: '' } }, 'c1');
    const r = runStaticChecks(src, { appliedSchema: APPLIED_GAP });
    assertNoKind(r, 'id_below_floor', 'f6 is above the f1/f5 floor of 5 — no diagnostic expected');
  });

  await test('schema: a collection absent from the applied schema has no floor — any allocation is clean', () => {
    const appliedOtherCollection: AppliedSchema = {
      collections: [{ id: 'c9', active: [{ id: 'f1', type: 'text' }], retired: [] }],
    };
    const src = schemaAppSourceFields({ a: { id: 'f1' } }, 'c1'); // c1 has no counterpart in applied
    const r = runStaticChecks(src, { appliedSchema: appliedOtherCollection });
    assertNoKind(r, 'id_below_floor', 'an unmatched collection is unconstrained — a first allocation there is always clean');
  });
}

// ── §schema identity — an edit candidate keeps the applied schema's collections and fields ──
// static-checks req "An edit candidate keeps the applied schema's collections and fields"
// (rewrite-preserves-user-data, design D6). `diffSchemas` reads an omission as a tolerable
// `older-subset`, so this rule is the ONLY thing standing between a rewrite and orphaned rows.

/** One collection of a candidate artifact: display name → burned ID, field display name →
 *  burned field ID, plus that collection's own tombstones. §D5's `schemaAppSourceFields`
 *  always emits ONE collection with `tombstones: []`, which the identity scenarios must vary. */
interface IdentityCollection {
  displayName: string;
  id: string;
  /** Field display name → burned field ID (all `text` — identity logic is type-agnostic). */
  fields: Record<string, string>;
  tombstones?: string[];
}

function identityAppSource(collections: IdentityCollection[]): string {
  const rendered = collections
    .map((c) => {
      const fields = Object.entries(c.fields)
        .map(([name, id]) => `${name}: { id: '${id}', type: 'text' }`)
        .join(', ');
      const tombstones = (c.tombstones ?? []).map((t) => `'${t}'`).join(', ');
      return `${c.displayName}: { id: '${c.id}', tombstones: [${tombstones}], fields: { ${fields} } }`;
    })
    .join(', ');
  return `
import { defineApp, type SchemaArtifact } from 'vc-sdk';
function Home() { return null; }
const SCHEMA: SchemaArtifact = { schemaVersion: 1, collections: { ${rendered} } };
export default defineApp({
  name: 'T', initial: 'Home', screens: { Home }, capabilities: [], schema: SCHEMA,
});
`;
}

async function testSchemaIdentityContinuity(): Promise<void> {
  const APPLIED_C1_F1_F2: AppliedSchema = {
    collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }, { id: 'f2', type: 'text' }], retired: [] }],
  };

  await test('§schema identity: an abandoned collection ID is schema_identity_drift, naming it', () => {
    const applied: AppliedSchema = { collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [] }] };
    const src = identityAppSource([{ displayName: 'Notes', id: 'c2', fields: { body: 'f1' } }]);

    // The engine alone cannot see this: an omitted collection is a lossless `older-subset`.
    const engineIncoming: SchemaArtifact = {
      schemaVersion: 1,
      collections: { Notes: { id: 'c2', tombstones: [], fields: { body: { id: 'f1', type: 'text' } } } },
    };
    assert(
      diffSchemas(applied, engineIncoming).kind !== 'conflict',
      'setup: diffSchemas must NOT flag this — an omission reads to the engine as a lossless older-subset, which is the gap this rule closes',
    );

    const r = runStaticChecks(src, { appliedSchema: applied });
    const d = assertHasKind(r, 'schema_identity_drift');
    assert(d.symbol === 'c1', `expected symbol "c1", got "${String(d.symbol)}"`);
    assert(d.severity === 'error', `identity drift is an error, got "${d.severity}"`);
    assert(/c1/.test(d.hint) && /rows/.test(d.hint), `hint must name c1 and say the user's rows live under it, got: ${d.hint}`);
  });

  await test('§schema identity: an active field ID the candidate neither declares nor tombstones is drift', () => {
    const src = identityAppSource([{ displayName: 'Notes', id: 'c1', fields: { title: 'f2' } }]);
    const r = runStaticChecks(src, { appliedSchema: APPLIED_C1_F1_F2 });
    const hits = findByKind(r, 'schema_identity_drift');
    assert(hits.length === 1, `expected exactly one drift (the dropped f1), got ${hits.length}: ${JSON.stringify(hits.map((h) => h.symbol))}`);
    assert(hits[0]?.symbol === 'f1', `expected symbol "f1", got "${String(hits[0]?.symbol)}"`);
    assert(/f1/.test(hits[0]?.hint ?? ''), `hint must name the abandoned field ID, got: ${String(hits[0]?.hint)}`);
  });

  await test('§schema identity: a deliberate tombstone in that collection is not drift', () => {
    const src = identityAppSource([{ displayName: 'Notes', id: 'c1', fields: { title: 'f2' }, tombstones: ['f1'] }]);
    const r = runStaticChecks(src, { appliedSchema: APPLIED_C1_F1_F2 });
    assertNoKind(r, 'schema_identity_drift', 'listing f1 in the collection\'s own tombstones is a deliberate goodbye, not drift');
  });

  await test('§schema identity: an already-retired field ID is exempt', () => {
    const applied: AppliedSchema = {
      collections: [{ id: 'c1', active: [{ id: 'f2', type: 'text' }], retired: [{ id: 'f1', type: 'text' }] }],
    };
    const src = identityAppSource([{ displayName: 'Notes', id: 'c1', fields: { title: 'f2' } }]);
    const r = runStaticChecks(src, { appliedSchema: applied });
    assertNoKind(r, 'schema_identity_drift', 'a retired ID is already unread by design — re-mentioning it is not required');
  });

  await test('§schema identity: a collection only the candidate has is unconstrained', () => {
    const src = identityAppSource([
      { displayName: 'Notes', id: 'c1', fields: { body: 'f1', title: 'f2' } },
      { displayName: 'Tags', id: 'c2', fields: { label: 'f1' } },
    ]);
    const r = runStaticChecks(src, { appliedSchema: APPLIED_C1_F1_F2 });
    assertNoKind(r, 'schema_identity_drift', 'growth is free — only abandonment is drift');
  });

  await test('§schema identity: a first generation (no applied schema) is unconstrained', () => {
    const src = identityAppSource([{ displayName: 'Notes', id: 'c2', fields: { body: 'f1' } }]);
    const r = runStaticChecks(src);
    assertNoKind(r, 'schema_identity_drift', 'with no applied schema there is no identity to keep');
  });

  await test('§schema identity: dropping the schema artifact ENTIRELY abandons every applied collection', () => {
    // The worst version of this mistake, and the one that used to slip through: a candidate that
    // declares no `schema` never reaches `diffSchemas`, and can go on naming the same collections
    // through the storage facade, so the surface pass sees nothing wrong either.
    const applied: AppliedSchema = {
      collections: [
        { id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [] },
        { id: 'c2', active: [{ id: 'f1', type: 'text' }], retired: [] },
      ],
    };
    const src = appSource("['storage']", 'defineApp, storage', 'return null;', "void storage.records.list('Notes');");
    const r = runStaticChecks(src, { appliedSchema: applied, previousSurface: scanStorageSurface(src) });
    assertNoKind(r, 'storage_surface_drift', 'setup: the candidate still names every location the previous version did — the surface pass has nothing to say');
    const hits = findByKind(r, 'schema_identity_drift');
    assert(hits.length === 2, `expected one drift per applied collection, got ${hits.length}: ${JSON.stringify(hits.map((h) => h.symbol))}`);
    assert(
      hits.map((h) => String(h.symbol)).sort((a, b) => a.localeCompare(b)).join(',') === 'c1,c2',
      `expected the abandoned collection IDs c1,c2, got ${JSON.stringify(hits.map((h) => h.symbol))}`,
    );
    assert(/c1/.test(hits[0]?.hint ?? ''), `hint must name the collection ID, got: ${String(hits[0]?.hint)}`);
  });

  await test('§schema identity: a schema-less candidate with NO applied schema is clean', () => {
    const src = appSource('[]');
    assertNoKind(runStaticChecks(src), 'schema_identity_drift', 'a first generation legitimately ships no schema');
    assertNoKind(
      runStaticChecks(src, { appliedSchema: { collections: [] } }),
      'schema_identity_drift',
      'an app that never created a collection has no rows to orphan — an empty applied schema is not an identity to keep',
    );
  });

  await test('§schema identity: a `schema` that is present but not statically analyzable is not accused of dropping it', () => {
    // `manifest_not_static` already fired; the artifact behind the call may well declare c1, so
    // claiming it was abandoned would be a false accusation on top of a real diagnostic.
    const src = `
import { defineApp } from 'vc-sdk';
function Home() { return null; }
function makeSchema() { return { schemaVersion: 1, collections: {} }; }
export default defineApp({
  name: 'T', initial: 'Home', screens: { Home }, capabilities: [], schema: makeSchema(),
});
`;
    const applied: AppliedSchema = { collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [] }] };
    const r = runStaticChecks(src, { appliedSchema: applied });
    assertHasKind(r, 'manifest_not_static', 'setup: an unresolvable schema is a manifest diagnostic');
    assertNoKind(r, 'schema_identity_drift', 'only an outright omission is drift — an unreadable artifact is a different mistake');
  });
}

// ── §storage continuity — an edit candidate keeps reading where the data already is ────────
// static-checks req "An edit candidate keeps reading where the data already is" (design
// D3/D4/D5). Superset, never equality; a non-literal argument warns and suppresses drift for
// THAT facade only. The baseline is always `scanStorageSurface` output — one scanner, two
// consumers — so these tests build it the way the generation server will.

/** A storage-using candidate: `setup` is spliced in as module-level code with `storage`
 *  imported and the capability declared, so the only diagnostics in play are continuity's. */
function storageApp(setup: string): string {
  return appSource("['storage']", 'defineApp, storage', 'return null;', setup);
}

async function testStorageContinuity(): Promise<void> {
  await test('§storage continuity: a dropped kv key is storage_surface_drift, naming it', () => {
    const previousSurface = scanStorageSurface(storageApp("const load = () => storage.kv.get('habitCompletionHistory');"));
    const r = runStaticChecks(appSource('[]'), { previousSurface });
    const d = assertHasKind(r, 'storage_surface_drift');
    assert(d.symbol === 'habitCompletionHistory', `expected symbol "habitCompletionHistory", got "${String(d.symbol)}"`);
    assert(d.severity === 'error', `drift is an error, got "${d.severity}"`);
    assert(/habitCompletionHistory/.test(d.hint) && /data/.test(d.hint), `hint must name the location and say the data lives there, got: ${d.hint}`);
  });

  await test('§storage continuity: a dropped record collection is drift; the one the candidate added is not', () => {
    const previousSurface = scanStorageSurface(storageApp("const all = () => storage.records.list('Completions');"));
    const r = runStaticChecks(storageApp("const all = () => storage.records.list('Streaks');"), { previousSurface });
    const hits = findByKind(r, 'storage_surface_drift');
    assert(hits.length === 1, `expected exactly one drift, got ${hits.length}: ${JSON.stringify(hits.map((h) => h.symbol))}`);
    assert(hits[0]?.symbol === 'Completions', `expected symbol "Completions", got "${String(hits[0]?.symbol)}"`);
  });

  await test('§storage continuity: the rule is superset — keeping both locations and adding one is clean', () => {
    const previousSurface = scanStorageSurface(
      storageApp("const load = () => storage.kv.get('total');\nconst all = () => storage.records.list('Completions');"),
    );
    const candidate = storageApp(
      [
        "const load = () => storage.kv.get('total');",
        "const all = () => storage.records.list('Completions');",
        "const add = () => storage.records.append('Streaks', { n: 1 });",
      ].join('\n'),
    );
    const r = runStaticChecks(candidate, { previousSurface });
    assertNoKind(r, 'storage_surface_drift', 'every previous location is still read — the addition is free');
    assertNoKind(r, 'storage_surface_dynamic', 'every argument is a literal');
  });

  await test('§storage continuity: a computed argument warns at its call site and suppresses drift for THAT facade only', () => {
    const previousSurface = scanStorageSurface(
      storageApp("const load = () => storage.kv.get('total');\nconst all = () => storage.records.list('Completions');"),
    );
    const candidate = storageApp("const someVariable = 'total';\nconst load = () => storage.kv.get(someVariable);");
    const r = runStaticChecks(candidate, { previousSurface });

    const dynamic = assertHasKind(r, 'storage_surface_dynamic');
    assert(dynamic.severity === 'warning', `the dynamic diagnostic is the one warning of this set, got "${dynamic.severity}"`);
    assert(dynamic.column !== undefined, 'the dynamic warning anchors at the offending argument, so it carries a column');
    assertAnchors(candidate, { line: dynamic.line, column: dynamic.column ?? 0 }, 'someVariable)', 'dynamic warning anchor');

    const drift = findByKind(r, 'storage_surface_drift');
    assert(
      drift.length === 1 && drift[0]?.symbol === 'Completions',
      `suppression is per facade: the kv drift is unprovable and suppressed, the records drift still fires — got ${JSON.stringify(drift.map((d) => d.symbol))}`,
    );
  });

  await test('§storage continuity: with no previous surface, neither kind is emitted', () => {
    const candidate = storageApp("const someVariable = 'total';\nconst load = () => storage.kv.get(someVariable);");
    const r = runStaticChecks(candidate);
    assertNoKind(r, 'storage_surface_drift', 'a first generation has nothing to be continuous with');
    assertNoKind(r, 'storage_surface_dynamic', 'and the warning is gated on the same input — a new app is unconstrained');
  });
}

// ── §E1 assembly: ordering / purity / determinism ─────────────

async function testAssemblyOrderingPurity(): Promise<void> {
  await test('assembly: independent passes accumulate (only the parse gate short-circuits)', () => {
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

  await test('purity: the same source checked twice (any order) yields deeply-equal, non-trivial reports', () => {
    const r1 = runStaticChecks(MULTI_PASS_SRC);
    const r2 = runStaticChecks(MULTI_PASS_SRC);
    assert(r1.diagnostics.length > 1, 'purity fixture must produce more than one diagnostic — an empty-array comparison would be vacuous');
    assert(JSON.stringify(r1) === JSON.stringify(r2), 'two checks of the identical source must produce deeply-equal reports');
  });

  await test('purity: a hostile top-level side effect is never observed — the checker never executes the source', () => {
    const sentinelKey = '__checksAcceptanceSentinel__';
    (globalThis as Record<string, unknown>)[sentinelKey] = false;
    const src = `(globalThis as any).${sentinelKey} = true;\nthrow new Error('this must never run');\n`;
    runStaticChecks(src);
    assert((globalThis as Record<string, unknown>)[sentinelKey] === false, 'checking hostile source must never execute it — the sentinel must remain false');
  });
}

// ── §E2 honest fixtures ──

async function testHonestFixturesAndLatencyProbe(): Promise<void> {
  const HONEST_FIXTURES = [
    'tip-splitter.app.tsx',
    'water-counter.app.tsx',
    'pour-over-timer.app.tsx',
    'style-gallery.app.tsx',
    'navigation-demo.app.tsx',
  ];

  await test('honest-corpus: every real honest fixture is ok with zero diagnostics', () => {
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

  await test('honest-corpus: corpus-shaped synthetic samples are ok with zero diagnostics', () => {
    for (const [label, src] of Object.entries(CORPUS_SAMPLES)) {
      const r = runStaticChecks(src);
      assert(r.ok === true, `corpus sample "${label}" should be ok, got diagnostics: ${JSON.stringify(r.diagnostics)}`);
      assert(r.diagnostics.length === 0, `corpus sample "${label}" should have zero diagnostics, got ${r.diagnostics.length}`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  await testContractAndHarnessSelfTests();
  await testStorageSurfaceScanner();
  await testParseGate();
  await testImportAllowlist();
  await testForbiddenGlobalsWalk();
  await testManifestExtraction();
  await testCapabilityDirections();
  await testScreenGraph();
  await testSdkLint();
  await testSchemaCheck();
  await testSchemaIdentityContinuity();
  await testStorageContinuity();
  await testAssemblyOrderingPurity();
  await testHonestFixturesAndLatencyProbe();
  await runHostileCorpus();
  await runReleaseSuites();
  await runSourceScans();
  await runHeaderLockstep();
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
