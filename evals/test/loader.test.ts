/**
 * Acceptance suite for chain-A (contract-loader-corpus): the corpus slug registry drift check
 * (design D11), the eval-set location resolver + loader/validator (design D2, D5), the committed
 * visible set, and the redaction entry point (design D3). Auto-discovered by
 * `evals/test/run.mjs` — no registry file to edit (D14). Runs with no eval set present: every
 * fixture here is synthetic and written to/read from a temp directory or this suite's own
 * literals, never a real holdout.
 */
/* eslint sonarjs/no-empty-test-file: "off" -- house tally idiom (`check`/`eq`), not a
   jest-shaped test file; sonarjs's `*.test.ts` heuristic doesn't recognize it. Every
   `evals/test/*.test.ts` file needs this same line (D14 naming convention, pinned in the
   contract) — see `handoff/eval-contract.md`. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSERTION_KINDS } from '../contract';
import type { EvalAssertion } from '../contract';
import { TIER0_SLUGS } from '../corpus';
import { EVAL_SET_ENV_VAR, EVAL_SET_FLAG, EvalSetError, loadEvalSet, resolveEvalSetLocation } from '../eval-set';
import { redactCase, sha256Hex } from '../redact';
import { caught, check, eq, section } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
section('corpus registry drift (design D11)');
// ─────────────────────────────────────────────────────────────────────────────

const repoRoot = process.cwd();
const corpusDocSlugs = parseTier0SlugsFromCorpusDoc(join(repoRoot, 'docs', 'app-corpus.md'));

check(
  'docs/app-corpus.md Tier-0 rows carry a slug',
  corpusDocSlugs.length > 0,
  `parsed ${corpusDocSlugs.length} Tier-0 slugs`,
);

const onlyInDoc = corpusDocSlugs.filter((slug) => !TIER0_SLUGS.includes(slug));
const onlyInRegistry = TIER0_SLUGS.filter((slug) => !corpusDocSlugs.includes(slug));
check(
  'registry and corpus document agree on Tier-0 slugs',
  onlyInDoc.length === 0 && onlyInRegistry.length === 0,
  `only in doc: [${onlyInDoc.join(', ')}], only in registry: [${onlyInRegistry.join(', ')}]`,
);

function parseTier0SlugsFromCorpusDoc(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((line) => line.trim().startsWith('|'));
  // Header + separator are the first two pipe rows; data rows follow.
  const dataRows = lines.slice(2);
  const slugs: string[] = [];
  for (const row of dataRows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const [tier, , slugCell] = cells;
    if (tier !== '0') continue;
    const match = /`([^`]+)`/.exec(slugCell ?? '');
    if (match) slugs.push(match[1]);
  }
  return slugs;
}

// ─────────────────────────────────────────────────────────────────────────────
section('eval-set location resolution (design D2)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const err = await caught(async () => {
    resolveEvalSetLocation([], {});
  });
  check('refuses when neither --eval-set nor WHIM_EVAL_SET is present', err instanceof EvalSetError);
  const message = err instanceof Error ? err.message : '';
  check(
    'refusal message names both the flag and the environment variable',
    message.includes(EVAL_SET_FLAG) && message.includes(EVAL_SET_ENV_VAR),
    message,
  );
}

eq(
  'flag overrides environment',
  resolveEvalSetLocation(['--eval-set', '/path/A'], { [EVAL_SET_ENV_VAR]: '/path/B' }),
  '/path/A',
);

eq('--eval-set=value form is accepted', resolveEvalSetLocation(['--eval-set=/path/C'], {}), '/path/C');

eq(
  'falls back to WHIM_EVAL_SET when no flag is present',
  resolveEvalSetLocation([], { [EVAL_SET_ENV_VAR]: '/path/D' }),
  '/path/D',
);

// ─────────────────────────────────────────────────────────────────────────────
section('eval-set loading and validation (design D5)');
// ─────────────────────────────────────────────────────────────────────────────

const scratchDir = mkdtempSync(join(tmpdir(), 'whim-eval-loader-test-'));

function writeSet(name: string, manifest: unknown): string {
  const dir = join(scratchDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return dir;
}

{
  const missing = join(scratchDir, 'does-not-exist');
  const err = await caught(() => { loadEvalSet(missing); });
  check('rejects a location that does not exist', err instanceof EvalSetError);
  check('names the resolved location', err instanceof Error && err.message.includes(missing), String(err));
}

{
  const dir = join(scratchDir, 'no-manifest');
  mkdirSync(dir, { recursive: true });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects a location with no readable manifest', err instanceof EvalSetError);
}

{
  const dir = writeSet('bad-visibility', { setId: 'x', visibility: 'secret', cases: [] });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects an unknown visibility value', err instanceof EvalSetError);
}

{
  const dir = writeSet('unknown-slug', {
    setId: 'x',
    visibility: 'visible',
    cases: [{ caseId: 'c1', appSlug: 'not-a-real-app', prompt: 'hello' }],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects an unknown app slug', err instanceof EvalSetError);
  check(
    'names the unknown slug',
    err instanceof Error && err.message.includes('not-a-real-app'),
    String(err),
  );
}

{
  const dir = writeSet('duplicate-case-id', {
    setId: 'x',
    visibility: 'visible',
    cases: [
      { caseId: 'dup', appSlug: 'tip-splitter', prompt: 'a' },
      { caseId: 'dup', appSlug: 'tip-splitter', prompt: 'b' },
    ],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects a duplicate case id', err instanceof EvalSetError);
}

{
  const dir = writeSet('missing-english', {
    setId: 'x',
    visibility: 'visible',
    cases: [
      {
        caseId: 'c1',
        appSlug: 'tip-splitter',
        prompt: 'hello',
        assertions: [{ kind: 'renders-without-error' }],
      },
    ],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects a Tier-B spec missing its English statement', err instanceof EvalSetError);
  check('names the offending case id', err instanceof Error && err.message.includes('c1'), String(err));
}

{
  const dir = writeSet('unknown-assertion-kind', {
    setId: 'x',
    visibility: 'visible',
    cases: [
      {
        caseId: 'c1',
        appSlug: 'tip-splitter',
        prompt: 'hello',
        assertions: [{ english: 'renders fine', kind: 'does-a-backflip' }],
      },
    ],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects an unknown assertion kind', err instanceof EvalSetError);
  const message = err instanceof Error ? err.message : '';
  check('names the offending kind', message.includes('does-a-backflip'), message);
  check(
    'names the closed set of accepted kinds',
    ASSERTION_KINDS.every((kind) => message.includes(kind)),
    message,
  );
}

{
  const dir = writeSet('assertion-as-code-string', {
    setId: 'x',
    visibility: 'visible',
    cases: [{ caseId: 'c1', appSlug: 'tip-splitter', prompt: 'hello', assertions: ["eval('1+1')"] }],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects an assertion expressed as a bare code string', err instanceof EvalSetError);
}

{
  const dir = writeSet('assertion-as-module-reference', {
    setId: 'x',
    visibility: 'visible',
    cases: [
      {
        caseId: 'c1',
        appSlug: 'tip-splitter',
        prompt: 'hello',
        assertions: [{ english: 'ok', kind: 'renders-without-error', module: './evil.js' }],
      },
    ],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('rejects an assertion carrying a module reference', err instanceof EvalSetError);
}

{
  const validAssertion: EvalAssertion = {
    english: 'the app renders without throwing',
    kind: 'renders-without-error',
  };
  const dir = writeSet('valid-set', {
    setId: 'valid-x',
    visibility: 'visible',
    cases: [
      {
        caseId: 'c1',
        appSlug: 'tip-splitter',
        prompt: 'make a tip calculator',
        expectation: 'splits the bill evenly',
        assertions: [validAssertion],
      },
    ],
  });
  const manifest = loadEvalSet(dir);
  eq('a valid manifest loads with its declared setId/visibility', {
    setId: manifest.setId,
    visibility: manifest.visibility,
  }, { setId: 'valid-x', visibility: 'visible' });
  eq('a valid case round-trips prompt/expectation/assertions', manifest.cases[0], {
    caseId: 'c1',
    appSlug: 'tip-splitter',
    prompt: 'make a tip calculator',
    expectation: 'splits the bill evenly',
    assertions: [validAssertion],
  });
}

rmSync(scratchDir, { recursive: true, force: true });

// ─────────────────────────────────────────────────────────────────────────────
section('committed visible set (task 1.6)');
// ─────────────────────────────────────────────────────────────────────────────

const visibleSetDir = join(repoRoot, 'evals', 'sets', 'visible');
check('the visible set directory exists', existsSync(visibleSetDir));

{
  const manifest = loadEvalSet(visibleSetDir);
  eq('the committed visible set declares visibility: visible', manifest.visibility, 'visible');
  eq('the committed visible set has 22 cases (11 apps x 2 phrasings)', manifest.cases.length, 22);

  const slugsCovered = new Set(manifest.cases.map((c) => c.appSlug));
  eq(
    'every Tier-0 slug is covered by the visible set',
    [...slugsCovered].sort((a, b) => a.localeCompare(b)),
    [...TIER0_SLUGS].sort((a, b) => a.localeCompare(b)),
  );

  const allPrompts = manifest.cases.every((c) => c.prompt.length > 0);
  check('every case has a non-empty prompt', allPrompts);
}

check('no placeholder holdout directory exists in the repo (design D2)', !existsSync(join(repoRoot, 'evals', 'sets', 'holdout')));

// ─────────────────────────────────────────────────────────────────────────────
section('no hand-maintained test registry (design D14)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const testDir = join(repoRoot, 'evals', 'test');
  const testFiles = readdirSync(testDir).filter((name) => name.endsWith('.test.ts'));
  check('this file is discoverable by evals/test/run.mjs', testFiles.includes('loader.test.ts'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('redaction (design D3)');
// ─────────────────────────────────────────────────────────────────────────────

const HOLDOUT_PROMPT = 'UNIQUE_HOLDOUT_PROMPT_TOKEN_do_not_leak_9f31';
const HOLDOUT_EXPECTATION = 'UNIQUE_HOLDOUT_EXPECTATION_TOKEN_do_not_leak_2ac7';
const HOLDOUT_CANDIDATE_SOURCE = 'UNIQUE_HOLDOUT_CANDIDATE_SOURCE_TOKEN_do_not_leak_51bd';

{
  const redacted = redactCase(
    { caseId: 'holdout-1', prompt: HOLDOUT_PROMPT, expectation: HOLDOUT_EXPECTATION, candidateSource: HOLDOUT_CANDIDATE_SOURCE },
    'holdout',
  );
  eq('a holdout case carries only caseId + promptSha256', redacted, {
    caseId: 'holdout-1',
    promptSha256: sha256Hex(HOLDOUT_PROMPT),
  });

  const serialized = JSON.stringify(redacted);
  check('the redacted case JSON contains no prompt text', !serialized.includes(HOLDOUT_PROMPT));
  check('the redacted case JSON contains no expectation prose', !serialized.includes(HOLDOUT_EXPECTATION));
  check('the redacted case JSON contains no candidate source', !serialized.includes(HOLDOUT_CANDIDATE_SOURCE));

  const capturedLogs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => capturedLogs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => capturedLogs.push(args.map(String).join(' '));
  try {
    console.log(`redacted case: ${serialized}`);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const consoleOutput = capturedLogs.join('\n');
  check(
    'console output produced from the redacted case leaks no holdout text',
    !consoleOutput.includes(HOLDOUT_PROMPT) &&
      !consoleOutput.includes(HOLDOUT_EXPECTATION) &&
      !consoleOutput.includes(HOLDOUT_CANDIDATE_SOURCE),
  );
}

{
  const visiblePrompt = 'a visible-set prompt, fine to keep';
  const redacted = redactCase({ caseId: 'visible-1', prompt: visiblePrompt, expectation: 'fine too' }, 'visible');
  eq('a visible case keeps prompt/expectation verbatim', redacted, {
    caseId: 'visible-1',
    promptSha256: sha256Hex(visiblePrompt),
    prompt: visiblePrompt,
    expectation: 'fine too',
    candidateSource: undefined,
  });
}

{
  const a = sha256Hex('same input');
  const b = sha256Hex('same input');
  eq('promptSha256 is deterministic for the same input', a, b);
  check('promptSha256 differs for different input', sha256Hex('one') !== sha256Hex('two'));
  eq('promptSha256 is a 64-char lowercase hex digest', /^[0-9a-f]{64}$/.test(a), true);
}
