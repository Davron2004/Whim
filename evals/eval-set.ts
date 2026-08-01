/**
 * The eval-set loader (design D2, D5). Resolution order is `--eval-set <path>` >
 * `WHIM_EVAL_SET` > REFUSE — there is no repo-embedded default location and no placeholder
 * holdout directory anywhere; the absence is load-bearing. `loadEvalSet` reads only the local
 * filesystem (no network access, structurally — this module imports nothing else) and validates
 * the manifest and every case, rejecting unknown app slugs, missing English statements, unknown
 * assertion kinds, and any assertion expressed as a code string or module reference.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSERTION_KINDS } from './contract';
import type { EvalAssertion, EvalCase, EvalSetManifest } from './contract';
import { isKnownCorpusSlug } from './corpus';

export class EvalSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalSetError';
  }
}

export const EVAL_SET_FLAG = '--eval-set';
export const EVAL_SET_ENV_VAR = 'WHIM_EVAL_SET';
const MANIFEST_FILE_NAME = 'manifest.json';

/** `argv` is the raw arguments (e.g. `process.argv.slice(2)`); `env` is `process.env`. Throws
 *  `EvalSetError` naming both the flag and the environment variable when neither is supplied. */
export function resolveEvalSetLocation(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): string {
  const flagValue = readFlagValue(argv, EVAL_SET_FLAG);
  if (flagValue !== undefined) return flagValue;

  const envValue = env[EVAL_SET_ENV_VAR];
  if (envValue !== undefined && envValue.length > 0) return envValue;

  throw new EvalSetError(
    `No eval set location supplied — pass ${EVAL_SET_FLAG} <path> or set the ${EVAL_SET_ENV_VAR} environment variable.`,
  );
}

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq !== undefined) return eq.slice(flag.length + 1);

  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined) {
    throw new EvalSetError(`${flag} requires a path argument.`);
  }
  return value;
}

/** Reads and validates the manifest at `location` (a directory containing `manifest.json`).
 *  Throws `EvalSetError` naming `location` and the specific defect on any failure. */
export function loadEvalSet(location: string): EvalSetManifest {
  if (!existsSync(location)) {
    throw new EvalSetError(`Eval set location does not exist: ${location}`);
  }

  const manifestPath = join(location, MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) {
    throw new EvalSetError(`Eval set at ${location} has no readable ${MANIFEST_FILE_NAME}.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new EvalSetError(`Eval set at ${location}: ${MANIFEST_FILE_NAME} is not valid JSON (${detail}).`);
  }

  return validateManifest(raw, location);
}

function validateManifest(raw: unknown, location: string): EvalSetManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EvalSetError(`Eval set at ${location}: manifest must be a JSON object.`);
  }
  const obj = raw as Record<string, unknown>;

  const setId = obj.setId;
  if (typeof setId !== 'string' || setId.length === 0) {
    throw new EvalSetError(`Eval set at ${location}: manifest.setId must be a non-empty string.`);
  }

  const visibility = obj.visibility;
  if (visibility !== 'visible' && visibility !== 'holdout') {
    throw new EvalSetError(
      `Eval set at ${location}: manifest.visibility must be "visible" or "holdout", got ${JSON.stringify(visibility)}.`,
    );
  }

  const rawCases = obj.cases;
  if (!Array.isArray(rawCases)) {
    throw new EvalSetError(`Eval set at ${location}: manifest.cases must be an array.`);
  }

  const seenIds = new Set<string>();
  const cases = rawCases.map((rawCase) => {
    const evalCase = validateCase(rawCase, location);
    if (seenIds.has(evalCase.caseId)) {
      throw new EvalSetError(`Eval set at ${location}: duplicate caseId "${evalCase.caseId}".`);
    }
    seenIds.add(evalCase.caseId);
    return evalCase;
  });

  return { setId, visibility, cases };
}

function validateCase(raw: unknown, location: string): EvalCase {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EvalSetError(`Eval set at ${location}: each case must be a JSON object.`);
  }
  const obj = raw as Record<string, unknown>;

  const caseId = obj.caseId;
  if (typeof caseId !== 'string' || caseId.length === 0) {
    throw new EvalSetError(`Eval set at ${location}: a case is missing a non-empty caseId.`);
  }

  const appSlug = obj.appSlug;
  if (typeof appSlug !== 'string' || appSlug.length === 0) {
    throw new EvalSetError(`Eval set at ${location}: case "${caseId}" is missing appSlug.`);
  }
  if (!isKnownCorpusSlug(appSlug)) {
    throw new EvalSetError(`Eval set at ${location}: case "${caseId}" names unknown app slug "${appSlug}".`);
  }

  const prompt = obj.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new EvalSetError(`Eval set at ${location}: case "${caseId}" is missing a non-empty prompt.`);
  }

  const expectation = obj.expectation;
  if (expectation !== undefined && typeof expectation !== 'string') {
    throw new EvalSetError(`Eval set at ${location}: case "${caseId}" expectation must be a string.`);
  }

  const rawAssertions = obj.assertions;
  let assertions: readonly EvalAssertion[] | undefined;
  if (rawAssertions !== undefined) {
    if (!Array.isArray(rawAssertions)) {
      throw new EvalSetError(`Eval set at ${location}: case "${caseId}" assertions must be an array.`);
    }
    assertions = rawAssertions.map((rawAssertion) => validateAssertion(rawAssertion, location, caseId));
  }

  return {
    caseId,
    appSlug,
    prompt,
    ...(expectation !== undefined ? { expectation } : {}),
    ...(assertions !== undefined ? { assertions } : {}),
  };
}

const FORBIDDEN_ASSERTION_KEYS = ['code', 'module', 'require', 'import', 'fn', 'eval'];

function validateAssertion(raw: unknown, location: string, caseId: string): EvalAssertion {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EvalSetError(
      `Eval set at ${location}: case "${caseId}" has an assertion expressed as a code string or module ` +
        `reference, which is refused — assertions must be plain data objects.`,
    );
  }
  const obj = raw as Record<string, unknown>;

  const forbiddenKey = FORBIDDEN_ASSERTION_KEYS.find((key) => key in obj);
  if (forbiddenKey !== undefined) {
    throw new EvalSetError(
      `Eval set at ${location}: case "${caseId}" has an assertion with field "${forbiddenKey}" — an ` +
        `unsupported assertion shape (code/module references are refused). Assertions must be inert data.`,
    );
  }

  const english = obj.english;
  if (typeof english !== 'string' || english.length === 0) {
    throw new EvalSetError(`Eval set at ${location}: case "${caseId}" has an assertion with no English statement.`);
  }

  const kind = obj.kind;
  if (typeof kind !== 'string' || !(ASSERTION_KINDS as readonly string[]).includes(kind)) {
    throw new EvalSetError(
      `Eval set at ${location}: case "${caseId}" names unknown assertion kind ${JSON.stringify(kind)}. ` +
        `Accepted kinds: ${ASSERTION_KINDS.join(', ')}.`,
    );
  }

  const target = obj.target;
  if (target !== undefined && typeof target !== 'string') {
    throw new EvalSetError(`Eval set at ${location}: case "${caseId}" assertion target must be a string.`);
  }

  const expected = obj.expected;
  if (expected !== undefined && typeof expected !== 'boolean') {
    throw new EvalSetError(`Eval set at ${location}: case "${caseId}" assertion expected must be a boolean.`);
  }

  return {
    english,
    kind: kind as EvalAssertion['kind'],
    ...(target !== undefined ? { target } : {}),
    ...(expected !== undefined ? { expected } : {}),
  };
}
