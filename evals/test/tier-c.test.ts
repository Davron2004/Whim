/**
 * Acceptance suite for chain-D (tier-c-judge-and-rubric): the scripted + replay judges, the live
 * judge's construction gating (never its `score`, which would make a network call — spec
 * "Acceptance suite is offline"), Tier C's verdict validation, and the rubric content-hash drift
 * check (design D8). Auto-discovered by `evals/test/run.mjs` (D14). Runs against this suite's own
 * committed fixtures only (`evals/test/fixtures/judge/`) plus synthetic literals — no eval set,
 * no network, no live model client is ever constructed here.
 */
/* eslint sonarjs/no-empty-test-file: "off" -- house tally idiom (`check`/`eq`), not a
   jest-shaped test file; sonarjs's `*.test.ts` heuristic doesn't recognize it. Every
   `evals/test/*.test.ts` file needs this same line (D14 naming convention, pinned in the
   contract) — see `handoff/eval-contract.md`. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunObservation, TierCResult } from '../contract';
import { createLiveJudge, LIVE_JUDGE_CREDENTIAL_ENV_VAR } from '../judge/live';
import { createReplayJudge, replayFileName } from '../judge/replay';
import { createScriptedJudge } from '../judge/scripted';
import type { Judge } from '../judge/judge';
import { extractScoredSection, hashScoredSection, RUBRIC_CONTENT_HASH, RUBRIC_DOCUMENT_PATH, RUBRIC_VERSION } from '../rubric';
import { evaluateTierC } from '../tiers/tier-c';
import { caught, check, eq, section } from './harness';

const repoRoot = process.cwd();
const fixturesDir = join(repoRoot, 'evals', 'test', 'fixtures', 'judge');

const OBSERVATION: RunObservation = {
  caseId: 'c1',
  diagnostics: [],
  declaredScreens: ['home'],
  reachedScreens: ['home'],
  syscallsInvoked: [],
  cuesInvoked: [],
  containment: { authenticated: true, contained: true },
};

function wellFormedVerdict(judgeIdentity: string) {
  return {
    rubricVersion: RUBRIC_VERSION,
    judgeIdentity,
    criteria: [
      { criterion: 'intent-fidelity', score: 5, rationale: 'Matches the prompt exactly.' },
      { criterion: 'usability', score: 4, rationale: 'Clear controls, minor label issue.' },
      { criterion: 'robustness', score: 3, rationale: 'Empty state is not handled.' },
      { criterion: 'polish', score: 5, rationale: 'Looks finished.' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
section('scripted judge (design D7)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const verdict = wellFormedVerdict('scripted:test');
  const judge = createScriptedJudge({ 'case-a': verdict });
  const result = await judge.score({ caseId: 'case-a', prompt: 'p', observation: OBSERVATION });
  eq('scripted judge returns the mapped verdict for a known case id', result, verdict);
}

{
  const judge = createScriptedJudge({});
  const err = await caught(async () => {
    await judge.score({ caseId: 'unmapped-case', prompt: 'p', observation: OBSERVATION });
  });
  check('scripted judge throws for an unmapped case id', err instanceof Error);
  check(
    'the throw names the offending case id',
    err instanceof Error && err.message.includes('unmapped-case'),
    String(err),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
section('replay judge (design D7)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const judge = createReplayJudge(fixturesDir);
  const result = await judge.score({ caseId: 'replay-case-1', prompt: 'p', observation: OBSERVATION });
  eq('replay judge replays the committed transcript keyed by case id + rubric version', result, {
    rubricVersion: 'v1',
    judgeIdentity: 'replay:fixture',
    criteria: [
      { criterion: 'intent-fidelity', score: 4, rationale: "Splits the bill per the prompt's request." },
      { criterion: 'usability', score: 5, rationale: 'Every control is clearly labeled.' },
      { criterion: 'robustness', score: 3, rationale: 'Zero-guest input is not handled.' },
      { criterion: 'polish', score: 4, rationale: 'Consistent layout, minor spacing issue.' },
    ],
  });
}

eq(
  'replayFileName keys on case id + rubric version',
  replayFileName('replay-case-1', 'v1'),
  'replay-case-1__v1.json',
);

{
  const judge = createReplayJudge(fixturesDir);
  const err = await caught(async () => {
    await judge.score({ caseId: 'no-such-case', prompt: 'p', observation: OBSERVATION });
  });
  check('replay judge throws when no transcript exists for the case', err instanceof Error);
  const message = err instanceof Error ? err.message : '';
  check('the throw names the case id', message.includes('no-such-case'), message);
  check('the throw names the rubric version', message.includes(RUBRIC_VERSION), message);
}

// ─────────────────────────────────────────────────────────────────────────────
section("live judge construction gating (spec 'Live judge requires explicit opt-in')");
// ─────────────────────────────────────────────────────────────────────────────

const originalApiKey = process.env[LIVE_JUDGE_CREDENTIAL_ENV_VAR];
delete process.env[LIVE_JUDGE_CREDENTIAL_ENV_VAR];

try {
  {
    const err = await caught(async () => {
      createLiveJudge({ model: 'openrouter/some-model', optIn: false });
    });
    check('refuses construction without the opt-in argument', err instanceof Error);
    check(
      'the refusal names opt-in',
      err instanceof Error && err.message.toLowerCase().includes('opt-in'),
      String(err),
    );
  }

  {
    const err = await caught(async () => {
      createLiveJudge({ model: 'openrouter/some-model', optIn: true });
    });
    check('refuses construction with opt-in but no credential in the environment', err instanceof Error);
    check(
      'the refusal names the credential environment variable',
      err instanceof Error && err.message.includes(LIVE_JUDGE_CREDENTIAL_ENV_VAR),
      String(err),
    );
  }

  process.env[LIVE_JUDGE_CREDENTIAL_ENV_VAR] = 'test-key-not-a-real-credential';
  {
    const err = await caught(async () => {
      createLiveJudge({ model: 'openrouter/some-model', optIn: true });
    });
    check('constructs without throwing once both opt-in and credential are present', err === undefined, String(err));
  }
} finally {
  if (originalApiKey === undefined) {
    delete process.env[LIVE_JUDGE_CREDENTIAL_ENV_VAR];
  } else {
    process.env[LIVE_JUDGE_CREDENTIAL_ENV_VAR] = originalApiKey;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
section("Tier C gating (spec 'Three tiers with declared gating semantics')");
// ─────────────────────────────────────────────────────────────────────────────

{
  const result = await evaluateTierC({
    caseId: 'c1',
    prompt: 'p',
    observation: OBSERVATION,
    tierAFailed: true,
    judge: createScriptedJudge({ c1: wellFormedVerdict('scripted:test') }),
  });
  eq('Tier A failure short-circuits Tier C regardless of a configured judge', result, {
    status: 'skipped',
    reason: 'tier_a_failed',
  });
}

{
  const result = await evaluateTierC({
    caseId: 'c1',
    prompt: 'p',
    observation: OBSERVATION,
    tierAFailed: false,
    judge: undefined,
  });
  eq('no judge configured records skipped: no_judge_configured', result, {
    status: 'skipped',
    reason: 'no_judge_configured',
  });
}

{
  const verdict = wellFormedVerdict('scripted:test');
  const result = await evaluateTierC({
    caseId: 'c1',
    prompt: 'p',
    observation: OBSERVATION,
    tierAFailed: false,
    judge: createScriptedJudge({ c1: verdict }),
  });
  eq('a well-formed verdict is recorded as scored, carrying rubricVersion + judge identity', result, {
    status: 'scored',
    verdict,
  });
}

{
  const brokenJudge: Judge = { score: async () => { throw new Error('transport exploded'); } };
  const result = await evaluateTierC({
    caseId: 'c1',
    prompt: 'p',
    observation: OBSERVATION,
    tierAFailed: false,
    judge: brokenJudge,
  });
  check('a judge that throws becomes a Tier C error, never a pass', result.status === 'error');
  check(
    'the error names the underlying defect',
    result.status === 'error' && result.message.includes('transport exploded'),
    JSON.stringify(result),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
section("malformed verdict is an error, not a pass (spec 'Malformed verdict is an error, not a pass')");
// ─────────────────────────────────────────────────────────────────────────────

async function tierCFor(judge: Judge): Promise<TierCResult> {
  return evaluateTierC({ caseId: 'c1', prompt: 'p', observation: OBSERVATION, tierAFailed: false, judge });
}

{
  const verdict = wellFormedVerdict('scripted:test');
  const missingCriterion = { ...verdict, criteria: verdict.criteria.filter((c) => c.criterion !== 'robustness') };
  const result = await tierCFor(createScriptedJudge({ c1: missingCriterion }));
  check('a verdict missing a rubric criterion is an error', result.status === 'error');
  check(
    'the error names the missing criterion',
    result.status === 'error' && result.message.includes('robustness'),
    JSON.stringify(result),
  );
}

{
  const verdict = wellFormedVerdict('scripted:test');
  const missingRationale = {
    ...verdict,
    criteria: verdict.criteria.map((c) => (c.criterion === 'usability' ? { ...c, rationale: '' } : c)),
  };
  const result = await tierCFor(createScriptedJudge({ c1: missingRationale }));
  check('a verdict missing a rationale is an error', result.status === 'error');
  check(
    'the error names the criterion missing its rationale',
    result.status === 'error' && result.message.includes('usability') && result.message.includes('rationale'),
    JSON.stringify(result),
  );
}

{
  const verdict = wellFormedVerdict('scripted:test');
  const outOfRange = {
    ...verdict,
    criteria: verdict.criteria.map((c) => (c.criterion === 'polish' ? { ...c, score: 99 } : c)),
  };
  const result = await tierCFor(createScriptedJudge({ c1: outOfRange }));
  check('a verdict scoring outside the rubric range is an error', result.status === 'error');
  check(
    'the error names the out-of-range criterion',
    result.status === 'error' && result.message.includes('polish') && result.message.includes('99'),
    JSON.stringify(result),
  );
}

{
  const verdict = wellFormedVerdict('scripted:test');
  const unknownCriterion = {
    ...verdict,
    criteria: [...verdict.criteria, { criterion: 'made-up-criterion', score: 3, rationale: 'n/a' }],
  };
  const result = await tierCFor(createScriptedJudge({ c1: unknownCriterion }));
  check('a verdict scoring an unknown criterion is an error', result.status === 'error');
  check(
    'the error names the unknown criterion',
    result.status === 'error' && result.message.includes('made-up-criterion'),
    JSON.stringify(result),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
section('rubric content hash drift (design D8)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const rubricMarkdown = readFileSync(join(repoRoot, RUBRIC_DOCUMENT_PATH), 'utf8');
  const scoredSection = extractScoredSection(rubricMarkdown);
  const actualHash = hashScoredSection(scoredSection);
  check(
    `${RUBRIC_DOCUMENT_PATH}'s scored content matches RUBRIC_CONTENT_HASH — if this fails, bump RUBRIC_VERSION and update RUBRIC_CONTENT_HASH in evals/rubric/index.ts`,
    actualHash === RUBRIC_CONTENT_HASH,
    `got ${actualHash}, expected ${RUBRIC_CONTENT_HASH}`,
  );
}

{
  const err = await caught(async () => {
    extractScoredSection('a document with no markers at all');
  });
  check('extractScoredSection throws when the scored-section markers are missing', err instanceof Error);
}

{
  const a = hashScoredSection('same content');
  const b = hashScoredSection('same content');
  eq('hashScoredSection is deterministic for the same input', a, b);
  check('hashScoredSection differs when the content differs', hashScoredSection('one') !== hashScoredSection('two'));
}
