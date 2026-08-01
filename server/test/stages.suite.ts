/**
 * server/test/stages.suite.ts — chain-5's suite: the concrete `CheckStage`/`BuildStage` and the
 * `WireAppRecord` assembler (`handoff/stage-contracts.md`). No Chromium (the run stage is chain
 * 6's, browser-backed suite); this file only drives the checker and the production esbuild
 * contract, both synchronous/Node-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { check, eq, section } from './harness';
import { createCheckStage, preflightSource } from '../src/generation/stages/check';
import { createBuildStage } from '../src/generation/stages/build';
import { assembleRecord } from '../src/generation/record';

const repoRoot = path.resolve(process.cwd());

function readFixture(name: string): string {
  return fs.readFileSync(path.join(repoRoot, 'fixtures', name), 'utf8');
}

function hasErrorDiagnostic(diagnostics: readonly { severity?: 'error' | 'warning' }[]): boolean {
  return diagnostics.some((d) => (d.severity ?? 'error') === 'error');
}

const HONEST_SOURCE = readFixture('tip-splitter.app.tsx'); // capabilities: [], no schema

const SCHEMA_SOURCE = `
import { defineApp, Screen, Text, type SchemaArtifact } from 'vc-sdk';
const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' } } } },
};
function Home() { return <Screen><Text>hi</Text></Screen>; }
export default defineApp({ name: 'Notes App', initial: 'Home', screens: { Home }, capabilities: ['storage'], schema: SCHEMA });
`;

const FORBIDDEN_GLOBAL_SOURCE = "fetch('http://evil.example');\n";

const WARNING_ONLY_SOURCE = 'setTimeout(() => {}, 1000);\n'; // raw_timer — a warning, no error

const COMPILED_BUNDLE_TEXT = '(function(){"use strict";var whimApp=(()=>{return{render:function(){}};})();window.__whimApp=whimApp;})();';

const UNRESOLVABLE_IMPORT_SOURCE = "import { nope } from 'this-package-does-not-exist-anywhere';\nexport default nope;\n";

// ── check stage: severity mapping + manifest extraction ────────────────────

async function testCheckStageSeverityMapping(): Promise<void> {
  section('Check stage — severity mapping (chain 5)');
  const stage = createCheckStage();

  const errorReport = await stage.check(FORBIDDEN_GLOBAL_SOURCE, {});
  check('an error-producing source yields an error-severity diagnostic', hasErrorDiagnostic(errorReport.diagnostics));
  const forbidden = errorReport.diagnostics.find((d) => d.kind === 'forbidden_global');
  check('the forbidden_global kind is forwarded verbatim', !!forbidden);
  eq('forwarded diagnostic severity is error', forbidden?.severity, 'error');

  const warningReport = await stage.check(WARNING_ONLY_SOURCE, {});
  check('a warnings-only source yields no error-severity diagnostic', !hasErrorDiagnostic(warningReport.diagnostics));
  const rawTimer = warningReport.diagnostics.find((d) => d.kind === 'raw_timer');
  eq('raw_timer diagnostic severity is warning', rawTimer?.severity, 'warning');

  const cleanReport = await stage.check(HONEST_SOURCE, {});
  eq('an honest fixture yields zero diagnostics', cleanReport.diagnostics.length, 0);
  check('an honest fixture still extracts a manifest', !!cleanReport.manifest);
  eq('extracted manifest name', cleanReport.manifest?.name, 'Tip Splitter');
  eq('extracted manifest.manifest carries capabilities, not schema', (cleanReport.manifest?.manifest as { capabilities?: unknown })?.capabilities, []);
  eq('a schema-less app maps to an empty wire schema object', cleanReport.manifest?.schema, {});

  const schemaReport = await stage.check(SCHEMA_SOURCE, {});
  eq('a schema-declaring app carries its schema on CheckedManifest.schema', (schemaReport.manifest?.schema as { schemaVersion?: unknown })?.schemaVersion, 1);

  // The allocation floor is threaded through: an applied schema whose collection's floor the
  // candidate violates surfaces id_below_floor through this same stage, unmodified.
  const appliedSchema = { collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }, { id: 'f5', type: 'text' }], retired: [] }] };
  const belowFloorSource = `
import { defineApp, Screen, Text, type SchemaArtifact } from 'vc-sdk';
const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' }, tag: { id: 'f3', type: 'text', default: '' } } } },
};
function Home() { return <Screen><Text>hi</Text></Screen>; }
export default defineApp({ name: 'Notes App', initial: 'Home', screens: { Home }, capabilities: ['storage'], schema: SCHEMA });
`;
  const floorReport = await stage.check(belowFloorSource, { appliedSchema });
  check('the check stage forwards id_below_floor from the applied-schema floor rule', floorReport.diagnostics.some((d) => d.kind === 'id_below_floor'));
}

// ── source pre-flight ───────────────────────────────────────────────────────

function testSourcePreflight(): void {
  section('Source pre-flight (spec: an edit without original source regenerates honestly)');

  eq('absent source stays absent', preflightSource(undefined), undefined);
  eq('a well-formed source with a default-exported defineApp passes through unchanged', preflightSource(HONEST_SOURCE), HONEST_SOURCE);

  const compiledResult = preflightSource(COMPILED_BUNDLE_TEXT);
  eq('compiled bundle text (no defineApp export) is treated as absent', compiledResult, undefined);

  const syntaxErrorResult = preflightSource('const x = ;\n');
  eq('a syntax error is treated as absent', syntaxErrorResult, undefined);

  // A candidate whose defineApp call is present but has a non-static field still passes the
  // pre-flight (it IS TypeScript with a real defineApp export) — the pre-flight only screens out
  // compiled/unparseable text, it is not a second copy of the full checker.
  const nonStaticButRealSource = "import { defineApp } from 'vc-sdk';\nfunction Home() { return null; }\nexport default defineApp({ name: 'T', initial: 'Home', screens: { Home }, capabilities: someArray });\n";
  check('a real (if diagnostic-bearing) defineApp export passes the pre-flight', preflightSource(nonStaticButRealSource) === nonStaticButRealSource);
}

// ── build stage ──────────────────────────────────────────────────────────────

async function testBuildStage(): Promise<void> {
  section('Build stage — production contract + build_failure mapping');
  const stage = createBuildStage();

  const goodOutcome = await stage.build(HONEST_SOURCE);
  check('a real candidate builds successfully', goodOutcome.ok);
  if (goodOutcome.ok) {
    check('the bundle is a non-empty IIFE string', goodOutcome.result.bundle.length > 0);
    check('a source map was produced', !!goodOutcome.result.sourceMap && goodOutcome.result.sourceMap.length > 0);
  }

  const badOutcome = await stage.build(UNRESOLVABLE_IMPORT_SOURCE);
  check('an unbuildable candidate fails the build stage', !badOutcome.ok);
  if (!badOutcome.ok) {
    eq('the failure maps to a build_failure diagnostic', badOutcome.diagnostic.kind, 'build_failure');
    eq('build_failure is an error', badOutcome.diagnostic.severity, 'error');
    check('the hint is non-empty and actionable', badOutcome.diagnostic.hint.trim().length > 0);
  }
}

// ── record assembly ─────────────────────────────────────────────────────────

async function testRecordAssembly(): Promise<void> {
  section('Record assembly — one extraction, no re-parse, no model prose');

  const stage = createCheckStage();
  const cleanReport = await stage.check(HONEST_SOURCE, {});
  check('setup: the honest fixture check has no errors', !hasErrorDiagnostic(cleanReport.diagnostics));
  check('setup: the honest fixture extracted a manifest', !!cleanReport.manifest);

  const build = { bundle: '(()=>{/* real build output */})();', sourceMap: '{"version":3}' };
  const record = assembleRecord(HONEST_SOURCE, cleanReport.manifest!, build);

  eq('record.name comes from the extraction, not any other source', record.name, 'Tip Splitter');
  eq('record.source is the checked source verbatim', record.source, HONEST_SOURCE);
  eq('record.bundle comes from the build result', record.bundle, build.bundle);
  eq('record.sourceMap comes from the build result', record.sourceMap, build.sourceMap);
  eq('record.manifest is the extraction, not a restated one', record.manifest, cleanReport.manifest!.manifest);
  eq('record.schema is the extraction, not a restated one', record.schema, cleanReport.manifest!.schema);

  // "not the model's prose": a manifest whose extracted name disagrees with a claim embedded
  // elsewhere in the source text must still win — assembleRecord takes only the already-extracted
  // CheckedManifest, so it structurally cannot consult the source's prose for the name/manifest/schema.
  const prosyManifest = { name: 'Extracted Name', manifest: { capabilities: ['storage'] }, schema: { schemaVersion: 1 } };
  const prosySource = '// The model claims: "this app is called Ignore Me and has no capabilities"\nconst x = 1;\n';
  const prosyRecord = assembleRecord(prosySource, prosyManifest, build);
  eq('the model-claimed name in a comment is never consulted', prosyRecord.name, 'Extracted Name');
  eq('the model-claimed capabilities in a comment are never consulted', (prosyRecord.manifest as { capabilities: unknown }).capabilities, ['storage']);

  // "a record is never assembled from a report carrying an error": demonstrated at the composition
  // boundary this chain owns — an error-carrying report is exactly what a caller (chain 6's
  // RunStage) must check via `diagnostics[].severity` BEFORE calling assembleRecord (design D6 —
  // the checker/record layer carries no severity-gate knob of its own). This suite proves that
  // check, an error-bearing candidate's report faithfully carries the error the caller gates on.
  const errorReport = await stage.check(FORBIDDEN_GLOBAL_SOURCE, {});
  check('an error-carrying report is identifiable via diagnostics[].severity before any record would be assembled', hasErrorDiagnostic(errorReport.diagnostics));
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runStagesTests(): Promise<void> {
  await testCheckStageSeverityMapping();
  testSourcePreflight();
  await testBuildStage();
  await testRecordAssembly();
}
