#!/usr/bin/env node
/**
 * The corpus-eval CLI (design D12/D13, task 6.1, `handoff/report.md`'s "what chain-F still
 * owns"). Three subcommands:
 *
 *   node evals/cli.mjs run --eval-set <path> (--source-dir <dir> | --generate) [--out <dir>]
 *   node evals/cli.mjs diff <baseReport.json> <candidateReport.json>
 *   node evals/cli.mjs compare <visibleReport.json> <holdoutReport.json> [--threshold <n>]
 *
 * Not yet wired to `npm run` (chain-G, `pending-class2.md`) — invoke directly, or via the
 * eventual `npm run evals -- <args>`.
 *
 * Mirrors the repo's esbuild-bundle-then-run idiom (`server/dev.mjs`, `evals/test/run.mjs`,
 * `evals/judge/live.ts`): this file's own top level is plain, untyped Node ESM (never
 * typechecked — it is not part of the root `tsc` program), and does exactly two things no typed
 * module here could: parse `argv`/write files/shell out to `git`, and bundle a TypeScript
 * "facade" (the CONTENTS constant below) that imports the real chain A–E modules plus
 * `./producer` by their real relative paths, so the CLI reuses their exact implementations —
 * `EvalSetError`, `resolveEvalSetLocation`, `buildReport`, `compareExitCode`, etc. — never a
 * re-declaration. The facade also reaches `SynthRunSession`/`createRunCandidate` (Tier A's
 * runtime leg — Playwright) via `./adapters/synthetic-run`'s re-export, never by importing
 * `../synthrun` itself (that stays the ONLY module permitted to do so, design D6), plus
 * `../server/src/pipeline` (the stub generation pipeline for `--generate`); Playwright is
 * external to this bundle so esbuild never tries to inline it (the same
 * "esbuild-in-esbuild"/native-module hazard `evals/test/run.mjs` avoids for `typescript`).
 *
 * Exit codes (the CLI's exit-code contract, spec "Eval runs are on demand..."):
 *   run:     0 clean; 1 any case failed (a sourcing error OR a `fail` verdict); 2 config error
 *            (missing/unreadable eval set, bad arguments).
 *   diff:    0 no regressions; 1 a regression is named; 2 a report file is unreadable.
 *   compare: `compareExitCode` verbatim (0 ok, 1 overfitting alarm, 2 refused) — plus 2 for a
 *            missing/unreadable report file or a non-numeric `--threshold`.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalsDir, '..');

const EXIT_OK = 0;
const EXIT_ALARM_OR_REGRESSION = 1;
const EXIT_CONFIG_ERROR = 2;

const DEFAULT_OUT_DIR = join(evalsDir, '.reports');

// ─────────────────────────────────────────────────────────────────────────────
// The TypeScript facade — bundled once per invocation, dynamically imported, then discarded.
// `resolveDir: evalsDir` is what makes every `./...`/`../...` specifier below resolve exactly
// like it would from a real file living at `evals/facade.ts`.
// ─────────────────────────────────────────────────────────────────────────────
const FACADE_SOURCE = `
import { readFileSync as readFileSyncNode } from 'node:fs';
import { EVAL_SET_ENV_VAR, EVAL_SET_FLAG, EvalSetError, loadEvalSet, resolveEvalSetLocation } from './eval-set';
import { evaluateTierA } from './tiers/tier-a';
import { evaluateTierB } from './tiers/tier-b';
import { evaluateTierC } from './tiers/tier-c';
import { tierAFailed } from './tiers/case';
import { observationFromRunReport, SynthRunSession, createRunCandidate } from './adapters/synthetic-run';
import { buildReport, serializeReport } from './report/serialize';
import { renderSummary } from './report/summary';
import { diffReports, renderDiff } from './report/diff';
import { compareReports, renderCompare, compareExitCode } from './report/compare';
import { sourceFromDirectory, sourceFromPipeline } from './producer';
import { createStubPipeline } from '../server/src/pipeline';

export { EvalSetError, EVAL_SET_FLAG, EVAL_SET_ENV_VAR, resolveEvalSetLocation, loadEvalSet };
export { renderSummary, renderDiff, renderCompare, compareExitCode };

export function readReportFile(path) {
  return JSON.parse(readFileSyncNode(path, 'utf8'));
}

export function diffReportsFacade(basePath, candidatePath) {
  const base = readReportFile(basePath);
  const candidate = readReportFile(candidatePath);
  return diffReports(base, candidate);
}

export function compareReportsFacade(visiblePath, holdoutPath, threshold) {
  const visible = readReportFile(visiblePath);
  const holdout = readReportFile(holdoutPath);
  return compareReports(visible, holdout, threshold);
}

/**
 * Sources every case (offline directory or an injected stub pipeline), evaluates Tier A/B/C for
 * every successfully-sourced case, and assembles the final report. A case whose sourcing
 * produced \`status: 'error'\` (missing file, generation failure, or a runner error — design
 * D12) is logged and excluded from \`cases\` — it never gets a fabricated candidate verdict.
 * Tier C always runs with no judge configured (\`no_judge_configured\`) — this CLI wires no
 * \`--judge\` flag yet, matching the fully-offline default the acceptance suite itself relies on.
 */
export async function runEvalSet(opts) {
  const { manifest, location, sourceDir, useGenerate, candidateLabel, runnerVersion } = opts;

  const sourced = sourceDir
    ? sourceFromDirectory(manifest.cases, sourceDir)
    : await sourceFromPipeline(manifest.cases, createStubPipeline(0));

  const sourcingErrors = [];
  const toEvaluate = [];
  for (const evalCase of manifest.cases) {
    const result = sourced.get(evalCase.caseId);
    if (!result || result.status === 'error') {
      const message = result ? result.message : \`no sourcing result produced for case "\${evalCase.caseId}"\`;
      sourcingErrors.push({ caseId: evalCase.caseId, message });
      continue;
    }
    toEvaluate.push({ evalCase, source: result.source });
  }

  const caseInputs = [];
  if (toEvaluate.length > 0) {
    const session = await SynthRunSession.launch();
    try {
      const runCandidate = createRunCandidate(session);
      for (const { evalCase, source } of toEvaluate) {
        const runReport = await runCandidate(source, { appId: evalCase.caseId });
        const observation = observationFromRunReport(evalCase.caseId, runReport);
        const tierA = evaluateTierA(source, observation);
        const failed = tierAFailed(tierA);
        const tierB = evaluateTierB({ assertions: evalCase.assertions ?? [], observation, tierAFailed: failed });
        const tierC = await evaluateTierC({
          caseId: evalCase.caseId,
          prompt: evalCase.prompt,
          expectation: evalCase.expectation,
          candidateSource: source,
          observation,
          tierAFailed: failed,
          judge: undefined,
        });
        caseInputs.push({
          caseId: evalCase.caseId,
          appSlug: evalCase.appSlug,
          prompt: evalCase.prompt,
          expectation: evalCase.expectation,
          candidateSource: source,
          tierA,
          tierB,
          tierC,
        });
      }
    } finally {
      await session.close();
    }
  }

  const startedAt = opts.startedAt;
  const finishedAt = new Date().toISOString();
  const report = buildReport({
    evalSet: { setId: manifest.setId, visibility: manifest.visibility, location },
    runnerVersion,
    candidateLabel,
    cases: caseInputs,
    startedAt,
    finishedAt,
  });

  return { report, sourcingErrors };
}
`;

async function loadFacade() {
  const outfile = join(evalsDir, `.cli-facade.${process.pid}.tmp.mjs`);
  await build({
    stdin: { contents: FACADE_SOURCE, resolveDir: evalsDir, sourcefile: 'facade.ts', loader: 'ts' },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfigRaw: '{}',
    logLevel: 'warning',
    // Playwright (native bindings), esbuild, and typescript must never be inlined into this
    // bundle — the same "esbuild-in-esbuild"/native-module hazard `evals/test/run.mjs` avoids
    // for `typescript` alone. Left external, Node resolves the real `node_modules/*` at runtime.
    external: ['playwright', 'esbuild', 'typescript'],
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(outfile, { force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plain argv/env helpers — no facade needed for these.
// ─────────────────────────────────────────────────────────────────────────────

function readFlagValue(argv, flag) {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq !== undefined) return eq.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function readRunnerVersion() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  return String(pkg.version ?? '0.0.0');
}

/** Refuses to write over a file `git` already tracks (spec "reports write under a git-ignored
 *  default directory, never overwrite a tracked file") — checked against the INDEX, so it
 *  refuses even before the file exists on disk locally. Returns `true` iff writing is refused. */
function isGitTracked(absPath) {
  const rel = relative(repoRoot, absPath);
  try {
    // `git` is resolved from PATH by design (a trusted, fixed-argument local repo-inspection
    // call, not untrusted input) — same precedent as `scripts/ruleset-probe.mjs`'s `gh` call.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFileSync('git', ['-C', repoRoot, 'ls-files', '--error-unmatch', rel], { stdio: 'pipe' });
    return true; // git found it in the index — a tracked file
  } catch {
    return false; // non-zero exit ⇒ not tracked (or not a git repo at all, which never applies here)
  }
}

/** Refuses an `--out` directory that already holds tracked content (e.g. a committed eval-set
 *  directory) — a fresh filename inside it would not individually collide with `isGitTracked`
 *  above, but writing scratch report output into a tracked directory is exactly the accidental
 *  contamination "never overwrite a tracked file" exists to prevent. */
function directoryHasTrackedFiles(absDir) {
  const rel = relative(repoRoot, absDir);
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see isGitTracked above
    const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '--', rel], { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString('utf8').trim().length > 0;
  } catch {
    return false;
  }
}

function writeReport(outDir, report, serializeReport) {
  if (directoryHasTrackedFiles(outDir)) {
    throw new Error(`refusing to write into ${outDir} — it already holds git-tracked content; pass a different --out directory.`);
  }
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${report.evalSet.setId}.json`);
  if (isGitTracked(outPath)) {
    throw new Error(`refusing to overwrite tracked file ${outPath} — pass a different --out directory.`);
  }
  writeFileSync(outPath, serializeReport(report), 'utf8');
  return outPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcommands
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves + loads the eval set, or returns `{ error }` naming what went wrong — factored out of
 *  `cmdRun` purely to keep its own cognitive complexity down. */
function loadManifestOrError(facade, argv) {
  try {
    const location = facade.resolveEvalSetLocation(argv, process.env);
    const manifest = facade.loadEvalSet(location);
    return { location, manifest };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Validates `--source-dir`/`--generate` are used exactly-one-of, or returns `{ error }`. */
function resolveSourcingModeOrError(argv) {
  const sourceDir = readFlagValue(argv, '--source-dir');
  const useGenerate = argv.includes('--generate');
  if (!sourceDir && !useGenerate) {
    return { error: 'run: pass exactly one of --source-dir <dir> or --generate to source candidates.' };
  }
  if (sourceDir && useGenerate) {
    return { error: 'run: pass only one of --source-dir <dir> or --generate, not both.' };
  }
  return { sourceDir, useGenerate };
}

function writeReportOrError(outDir, report, serializeReport) {
  try {
    return { outPath: writeReport(outDir, report, serializeReport) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function cmdRun(argv) {
  const facade = await loadFacade();

  const resolved = loadManifestOrError(facade, argv);
  if (resolved.error) {
    console.error(resolved.error);
    return EXIT_CONFIG_ERROR;
  }
  const { location, manifest } = resolved;

  const sourcing = resolveSourcingModeOrError(argv);
  if (sourcing.error) {
    console.error(sourcing.error);
    return EXIT_CONFIG_ERROR;
  }
  const { sourceDir, useGenerate } = sourcing;

  const outDir = readFlagValue(argv, '--out') ?? DEFAULT_OUT_DIR;
  const candidateLabel =
    readFlagValue(argv, '--candidate-label') ?? (sourceDir ? `source-dir:${sourceDir}` : 'generate:stub');

  const { report, sourcingErrors } = await facade.runEvalSet({
    manifest,
    location,
    sourceDir,
    useGenerate,
    candidateLabel,
    runnerVersion: readRunnerVersion(),
    startedAt: new Date().toISOString(),
  });

  for (const err of sourcingErrors) {
    console.error(`CASE ERROR ${err.caseId}: ${err.message}`);
  }

  const written = writeReportOrError(outDir, report, facade.serializeReport ?? ((r) => JSON.stringify(r, null, 2)));
  if (written.error) {
    console.error(written.error);
    return EXIT_CONFIG_ERROR;
  }

  console.log(facade.renderSummary(report));
  console.log(`report written to ${written.outPath}`);

  const anyCaseFailed = report.cases.some((c) => c.verdict === 'fail');
  return sourcingErrors.length > 0 || anyCaseFailed ? EXIT_ALARM_OR_REGRESSION : EXIT_OK;
}

async function cmdDiff(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const [basePath, candidatePath] = positional;
  if (!basePath || !candidatePath) {
    console.error('diff: usage: evals/cli.mjs diff <baseReport.json> <candidateReport.json>');
    return EXIT_CONFIG_ERROR;
  }
  if (!existsSync(basePath) || !existsSync(candidatePath)) {
    console.error(`diff: report file not found (base=${basePath} exists=${existsSync(basePath)}, ` +
      `candidate=${candidatePath} exists=${existsSync(candidatePath)}).`);
    return EXIT_CONFIG_ERROR;
  }

  const facade = await loadFacade();
  let diff;
  try {
    diff = facade.diffReportsFacade(basePath, candidatePath);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return EXIT_CONFIG_ERROR;
  }

  console.log(facade.renderDiff(diff));
  const hasRegressions = diff.tierARegressions.length > 0 || diff.tierBRegressions.length > 0;
  return hasRegressions ? EXIT_ALARM_OR_REGRESSION : EXIT_OK;
}

async function cmdCompare(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const [visiblePath, holdoutPath] = positional;
  const thresholdRaw = readFlagValue(argv, '--threshold') ?? '0.1';
  const threshold = Number(thresholdRaw);
  if (!visiblePath || !holdoutPath) {
    console.error('compare: usage: evals/cli.mjs compare <visibleReport.json> <holdoutReport.json> [--threshold <n>]');
    return EXIT_CONFIG_ERROR;
  }
  if (!existsSync(visiblePath) || !existsSync(holdoutPath)) {
    console.error(`compare: report file not found (visible=${visiblePath} exists=${existsSync(visiblePath)}, ` +
      `holdout=${holdoutPath} exists=${existsSync(holdoutPath)}).`);
    return EXIT_CONFIG_ERROR;
  }
  if (!Number.isFinite(threshold)) {
    console.error(`compare: --threshold must be a number, got ${JSON.stringify(thresholdRaw)}.`);
    return EXIT_CONFIG_ERROR;
  }

  const facade = await loadFacade();
  const outcome = facade.compareReportsFacade(visiblePath, holdoutPath, threshold);
  console.log(facade.renderCompare(outcome));
  return facade.compareExitCode(outcome);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  switch (subcommand) {
    case 'run':
      return cmdRun(rest);
    case 'diff':
      return cmdDiff(rest);
    case 'compare':
      return cmdCompare(rest);
    default:
      console.error('usage: evals/cli.mjs <run|diff|compare> [...args]');
      return EXIT_CONFIG_ERROR;
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exitCode = EXIT_CONFIG_ERROR;
  },
);
