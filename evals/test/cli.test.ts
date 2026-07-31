/**
 * Acceptance suite for chain-F (cli-sourcing-docs): candidate sourcing (`evals/producer.ts`,
 * design D12) offline and against an injected pipeline, the exactly-one-terminal-event runner
 * error, and the CLI's own argument/exit-code contract (`evals/cli.mjs`) — resolution-order
 * refusal, flag-beats-environment, unreadable-set refusal, the exit-code matrix across
 * `run`/`diff`/`compare`, and the gate-configuration check. Auto-discovered by
 * `evals/test/run.mjs` (D14).
 *
 * Deliberately Chromium-free, matching every other suite in `evals/test/` (`tier-a.test.ts`: "No
 * Chromium is launched anywhere in this file"): `sourceFromDirectory`/`sourceFromPipeline` never
 * touch a browser, and every CLI-subprocess invocation below is constructed to fail or complete
 * BEFORE `run` would ever need to source a real candidate through Tier A (a missing-file sourcing
 * error, or an eval set with zero cases) — `run`'s own real Tier-A/Chromium path is exercised only
 * by hand (see the chain-F report), never by this suite (spec "Eval runs are on demand and never
 * part of the automated gate": running a real candidate costs browser time).
 */
/* eslint sonarjs/no-empty-test-file: "off" -- house tally idiom (`check`/`eq`), not a
   jest-shaped test file; sonarjs's `*.test.ts` heuristic doesn't recognize it. Every
   `evals/test/*.test.ts` file needs this same line (D14 naming convention, pinned in the
   contract) — see `handoff/eval-contract.md`. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerationEvent } from '@whim/contract';
import { EVAL_SET_ENV_VAR, EVAL_SET_FLAG } from '../eval-set';
import type { CandidatePipeline, SourceableCase } from '../producer';
import { sourceFromDirectory, sourceFromPipeline } from '../producer';
import { buildReport } from '../report/serialize';
import type { CaseInput } from '../report/serialize';
import type { EvalRunReport, TierAResult, TierBResult, TierCResult } from '../contract';
import { caught, check, eq, section } from './harness';

// A narrow local augmentation of the shared `node:fs`/`node:child_process` ambient surface
// (`evals/env.d.ts`) — adds `spawnSync` only (a distinct export name, no conflict with the
// shared `execFileSync` declaration) for this suite's CLI-subprocess invocations.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options?: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly encoding?: 'utf8';
    },
  ): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

const repoRoot = process.cwd();
const cliPath = join(repoRoot, 'evals', 'cli.mjs');

/** Merges `overrides` over the current environment and DROPS any key whose value is
 *  `undefined` (rather than passing the literal string `"undefined"`, which `spawnSync` would
 *  otherwise stringify it as) — the only way to reliably test "this variable is truly absent". */
// Declaration-merges with `evals/env.d.ts`'s global `WhimProcess` — adds `execPath` only, so
// `runCli` can invoke the exact same Node binary running this suite instead of resolving `node`
// from `PATH` (sidesteps `sonarjs/no-os-command-from-path` for real, not with a suppression).
// This file is a module (has top-level imports), so the augmentation needs `declare global`.
declare global {
  interface WhimProcess {
    readonly execPath: string;
  }
}

function runCli(
  args: readonly string[],
  overrides: Record<string, string | undefined> = {},
): { status: number | null; stdout: string; stderr: string } {
  const merged: Record<string, string | undefined> = { ...process.env, ...overrides };
  const env: Record<string, string> = {};
  for (const key of Object.keys(merged)) {
    const value = merged[key];
    if (value !== undefined) env[key] = value;
  }
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, env, encoding: 'utf8' });
}

const scratchDir = mkdtempSync(join(tmpdir(), 'whim-eval-cli-test-'));
function scratch(...parts: string[]): string {
  return join(scratchDir, ...parts);
}
function writeEvalSet(name: string, manifest: unknown): string {
  const dir = scratch(name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
section('producer: offline --source-dir sourcing (spec "Fully offline sourcing", "Missing candidate source")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const dir = scratch('source-dir-offline');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'c1.ts'), 'export const marker = "c1-source";', 'utf8');

  const cases: SourceableCase[] = [
    { caseId: 'c1', prompt: 'p1' },
    { caseId: 'c2', prompt: 'p2' },
  ];
  const results = sourceFromDirectory(cases, dir);

  const c1 = results.get('c1');
  check('a covered case id is sourced from disk', c1?.status === 'sourced' && c1.source.includes('c1-source'));

  const c2 = results.get('c2');
  check('an uncovered case id is recorded as a missing-source error', c2?.status === 'error' && c2.kind === 'missing-source');
  check(
    'the missing-source error names the case id',
    c2?.status === 'error' && c2.message.includes('c2'),
    c2?.status === 'error' ? c2.message : '',
  );
  check('sourcing one missing file does not stop the other case from being sourced', c1?.status === 'sourced');
}

// ─────────────────────────────────────────────────────────────────────────────
section('producer: pipeline sourcing consumes exactly one terminal event (spec, design D12)');
// ─────────────────────────────────────────────────────────────────────────────

function stubResultEvent(source: string): GenerationEvent {
  return {
    type: 'result',
    app: { name: 'stub', source, bundle: '(()=>{})();', manifest: {}, schema: {} },
  };
}
function stubFailureEvent(reason: string): GenerationEvent {
  return { type: 'failure', reason, attempts: 1, diagnostics: [] };
}

function pipelineOf(events: readonly GenerationEvent[]): CandidatePipeline {
  return {
    async *run() {
      for (const event of events) yield event;
    },
  };
}

{
  const cases: SourceableCase[] = [{ caseId: 'c1', prompt: 'p1' }];
  const results = await sourceFromPipeline(cases, pipelineOf([stubResultEvent('generated-source')]));
  const c1 = results.get('c1');
  eq('exactly one result terminal event sources the candidate', c1, { status: 'sourced', source: 'generated-source' });
}

{
  const cases: SourceableCase[] = [{ caseId: 'c1', prompt: 'p1' }];
  const results = await sourceFromPipeline(cases, pipelineOf([stubFailureEvent('could not comply')]));
  const c1 = results.get('c1');
  check('exactly one failure terminal event is a generation-failure, not a runner error', c1?.status === 'error' && c1.kind === 'generation-failure');
  check('the generation-failure names the reason', c1?.status === 'error' && c1.message.includes('could not comply'));
}

{
  const cases: SourceableCase[] = [{ caseId: 'c1', prompt: 'p1' }];
  const twoTerminals = await sourceFromPipeline(cases, pipelineOf([stubResultEvent('a'), stubResultEvent('b')]));
  const c1 = twoTerminals.get('c1');
  check('two terminal events is a runner error, never a candidate verdict', c1?.status === 'error' && c1.kind === 'runner-error');

  const zeroTerminals = await sourceFromPipeline(cases, pipelineOf([]));
  const c1b = zeroTerminals.get('c1');
  check('zero terminal events is also a runner error', c1b?.status === 'error' && c1b.kind === 'runner-error');
}

{
  const cases: SourceableCase[] = [{ caseId: 'c1', prompt: 'p1' }];
  const throwingPipeline: CandidatePipeline = {
    run(): AsyncIterable<GenerationEvent> {
      throw new Error('transport exploded');
    },
  };
  const results = await sourceFromPipeline(cases, throwingPipeline);
  const c1 = results.get('c1');
  check('a pipeline that throws is recorded as a runner error, not silently dropped', c1?.status === 'error' && c1.kind === 'runner-error');
}

// ─────────────────────────────────────────────────────────────────────────────
section('CLI run: eval-set resolution (spec "The eval set is supplied at run time and never embedded")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const result = runCli(['run'], { WHIM_EVAL_SET: undefined });
  check('refuses with neither --eval-set nor WHIM_EVAL_SET', result.status !== 0);
  check(
    'the refusal names both the flag and the environment variable',
    result.stderr.includes(EVAL_SET_FLAG) && result.stderr.includes(EVAL_SET_ENV_VAR),
    result.stderr,
  );
}

{
  const missing = scratch('no-such-eval-set');
  const result = runCli(['run', '--eval-set', missing, '--generate']);
  check('refuses when the location does not exist', result.status !== 0);
  check('the refusal names the resolved location', result.stderr.includes(missing), result.stderr);
}

{
  const emptySetA = writeEvalSet('flag-wins-a', { setId: 'flag-wins', visibility: 'visible', cases: [] });
  writeEvalSet('flag-wins-b', { setId: 'should-not-load', visibility: 'visible', cases: [] });
  const outDir = scratch('out-flag-wins');
  const result = runCli(
    ['run', '--eval-set', emptySetA, '--source-dir', scratch('unused'), '--out', outDir],
    { WHIM_EVAL_SET: scratch('flag-wins-b') },
  );
  check('a zero-case run with --eval-set present exits clean', result.status === 0, `status=${result.status} stderr=${result.stderr}`);
  const report = JSON.parse(readFileSync(join(outDir, 'flag-wins.json'), 'utf8')) as EvalRunReport;
  eq('--eval-set wins over WHIM_EVAL_SET: the report records the flag location', report.evalSet.location, emptySetA);
}

// ─────────────────────────────────────────────────────────────────────────────
section('CLI run: exit-code matrix (spec "Eval runs are on demand...", `handoff/report.md`)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const emptySet = writeEvalSet('clean-empty', { setId: 'clean-empty', visibility: 'visible', cases: [] });
  const result = runCli(['run', '--eval-set', emptySet, '--source-dir', scratch('unused-2'), '--out', scratch('out-clean')]);
  eq('a clean run (no cases, no sourcing errors) exits 0', result.status, 0);
}

{
  const oneCase = writeEvalSet('one-case', {
    setId: 'one-case',
    visibility: 'visible',
    cases: [{ caseId: 'c1', appSlug: 'tip-splitter', prompt: 'hello' }],
  });
  const result = runCli(['run', '--eval-set', oneCase, '--source-dir', scratch('missing-sources'), '--out', scratch('out-case-failure')]);
  eq('a case that fails to source (missing file) exits with the case-failure code', result.status, 1);
  check('the sourcing error is printed naming the case id', result.stderr.includes('c1'), result.stderr);
}

{
  const emptySet = writeEvalSet('bad-args', { setId: 'bad-args', visibility: 'visible', cases: [] });
  const result = runCli(['run', '--eval-set', emptySet]);
  eq('passing neither --source-dir nor --generate is a config error', result.status, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
section('CLI run: file-write behavior (spec "reports write under a git-ignored default directory, never overwrite a tracked file")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const emptySet = writeEvalSet('default-out', { setId: 'default-out', visibility: 'visible', cases: [] });
  const defaultOutFile = join(repoRoot, 'evals', '.reports', 'default-out.json');
  rmSync(defaultOutFile, { force: true });
  const result = runCli(['run', '--eval-set', emptySet, '--source-dir', scratch('unused-3')]);
  check('with no --out, the report lands under the default git-ignored evals/.reports directory', result.status === 0);
  check('the default-output file was actually written', readFileSync(defaultOutFile, 'utf8').length > 0);
  rmSync(defaultOutFile, { force: true });
}

{
  const emptySet = writeEvalSet('tracked-refusal', { setId: 'tracked-refusal', visibility: 'visible', cases: [] });
  // `evals/sets/visible/` is a real, git-tracked directory (task 1.6) — a safe, always-present
  // target to prove the refusal against, without ever risking a real overwrite: the CLI must
  // refuse before writing anything.
  const trackedDir = join(repoRoot, 'evals', 'sets', 'visible');
  const result = runCli(['run', '--eval-set', emptySet, '--source-dir', scratch('unused-4'), '--out', trackedDir]);
  check('refuses to write a report into a directory holding git-tracked content', result.status !== 0, `status=${result.status}`);
  check('the refusal names the tracked directory', result.stderr.includes('tracked'), result.stderr);
}

// ─────────────────────────────────────────────────────────────────────────────
section('CLI diff/compare: exit codes (no eval set, no Chromium — prebuilt report fixtures only)');
// ─────────────────────────────────────────────────────────────────────────────

const PASS_A: TierAResult = { status: 'pass', diagnostics: [], containment: { authenticated: true, contained: true } };

function tierB(status: 'pass' | 'fail'): TierBResult {
  return {
    status: 'evaluated',
    assertions: [{ english: 'the Home screen is reachable', kind: 'screen-reachable', status, observed: [] }],
  };
}
const NO_TIER_C: TierCResult = { status: 'skipped', reason: 'no_judge_configured' };

function caseInput(caseId: string, prompt: string, tierBStatus: 'pass' | 'fail'): CaseInput {
  return {
    caseId,
    appSlug: 'tip-splitter',
    prompt,
    tierA: PASS_A,
    tierB: tierB(tierBStatus),
    tierC: NO_TIER_C,
  };
}

function writeReportFixture(path: string, cases: readonly CaseInput[]): EvalRunReport {
  const report = buildReport({
    evalSet: { setId: 'fixture-set', visibility: 'visible', location: 'evals/sets/fixture' },
    runnerVersion: 'test-runner',
    candidateLabel: 'test-candidate',
    cases,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
  });
  writeFileSync(path, JSON.stringify(report), 'utf8');
  return report;
}

{
  const base = scratch('diff-base.json');
  const candidate = scratch('diff-candidate-clean.json');
  writeReportFixture(base, [caseInput('c1', 'p1', 'pass')]);
  writeReportFixture(candidate, [caseInput('c1', 'p1', 'pass')]);
  const result = runCli(['diff', base, candidate]);
  eq('diff with no regressions exits 0', result.status, 0);
}

{
  const base = scratch('diff-base-2.json');
  const candidate = scratch('diff-candidate-regressed.json');
  writeReportFixture(base, [caseInput('c1', 'p1', 'pass')]);
  writeReportFixture(candidate, [caseInput('c1', 'p1', 'fail')]);
  const result = runCli(['diff', base, candidate]);
  eq('diff naming a Tier B regression exits 1', result.status, 1);
  check('the regression output names the case id', result.stdout.includes('c1'), result.stdout);
}

{
  const visible = scratch('compare-visible.json');
  const holdout = scratch('compare-holdout.json');
  writeReportFixture(visible, [
    caseInput('p1', 'p1', 'pass'), caseInput('p2', 'p2', 'pass'), caseInput('p3', 'p3', 'pass'), caseInput('p4', 'p4', 'pass'),
  ]);
  writeReportFixture(holdout, [
    caseInput('p1', 'p1', 'pass'), caseInput('p2', 'p2', 'fail'), caseInput('p3', 'p3', 'fail'), caseInput('p4', 'p4', 'fail'),
  ]);
  const result = runCli(['compare', visible, holdout, '--threshold', '0.1']);
  eq('compare beyond threshold exits with the alarm code (1)', result.status, 1);
}

{
  const visible = scratch('compare-visible-clean.json');
  const holdout = scratch('compare-holdout-clean.json');
  writeReportFixture(visible, [caseInput('c1', 'p1', 'pass')]);
  writeReportFixture(holdout, [caseInput('c1', 'p1', 'pass')]);
  const result = runCli(['compare', visible, holdout, '--threshold', '0.1']);
  eq('compare within threshold exits clean (0)', result.status, 0);
}

{
  const visible = scratch('compare-visible-refuse.json');
  const holdout = scratch('compare-holdout-refuse.json');
  const holdoutReport = writeReportFixture(holdout, [caseInput('c1', 'p1', 'pass')]);
  writeReportFixture(visible, [caseInput('c1', 'p1', 'pass')]);
  writeFileSync(holdout, JSON.stringify({ ...holdoutReport, schemaVersion: holdoutReport.schemaVersion + 1 }), 'utf8');
  const result = runCli(['compare', visible, holdout, '--threshold', '0.1']);
  eq('a schema-version mismatch exits with the refused code (2)', result.status, 2);
}

rmSync(scratchDir, { recursive: true, force: true });

// ─────────────────────────────────────────────────────────────────────────────
section('gate configuration (spec "Eval runs are on demand and never part of the automated gate")');
// ─────────────────────────────────────────────────────────────────────────────

{
  // This file only READS `scripts/gate.sh` — a protected file agents never edit
  // (`.claude/hooks/protect-harness.sh`); reading it is fine.
  const gateContents = readFileSync(join(repoRoot, 'scripts', 'gate.sh'), 'utf8');
  check(
    'the gate never invokes a corpus-eval run (evals/cli.mjs, or an `evals run` command)',
    !gateContents.includes('cli.mjs') && !/\bevals[: ]run\b/.test(gateContents),
    'a corpus-eval RUN invocation must never appear in the gate — eval runs cost model spend and browser time',
  );
  // As of this chain, the runner's OWN acceptance-suite entry (`check "corpus-eval" npm run -s
  // evals:test`) is NOT yet in the gate — it is recorded, unapplied, in
  // `openspec/changes/eval-harness/pending-class2.md` (design D13: package.json/gate.sh/
  // tsconfig.json/knip.json are Class-2, human-only). This assertion locks TODAY's true state
  // rather than asserting the post-bootstrap scenario as if it already held; once a human
  // applies that pending diff, this check (and this comment) must be updated to assert
  // PRESENCE instead, and the suite itself becomes reachable via `npm run -s evals:test` from
  // inside the gate rather than only via `node evals/test/run.mjs` directly.
  check(
    'the corpus-eval acceptance-suite entry is not yet wired into the gate (pending-class2.md, design D13)',
    !gateContents.includes('"corpus-eval"'),
    'if this fails, a human has applied pending-class2.md(c) — update this test to assert presence instead',
  );
}

{
  // Scenario "Acceptance suite needs no eval set": this whole suite (including everything
  // above) already ran with neither --eval-set nor WHIM_EVAL_SET set in ITS OWN process env —
  // demonstrated structurally: nothing in this file reads WHIM_EVAL_SET for itself, only passes
  // it explicitly to CLI subprocesses under test.
  const err = await caught(async () => {
    if (process.env[EVAL_SET_ENV_VAR] !== undefined) {
      throw new Error(`this suite's own process must not run with ${EVAL_SET_ENV_VAR} set`);
    }
  });
  check('this acceptance suite runs with no eval set present in its own environment', err === undefined);
}
