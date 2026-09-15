/**
 * server/src/generation/prompts/inputs.ts — the two disk-backed prompt inputs (design D10, spec
 * "Prompt assembly has one source of truth per input"): the vc-sdk reference document and the
 * curated few-shot fixture list. Both are read fresh from the repo, never transcribed into source,
 * so there is exactly one copy of each. Call `loadPromptInputs` once (composition-root time); the
 * message builders in `./index.ts` take the result as a plain argument, not disk access of their
 * own.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface FewShotExample {
  /** File name under `fixtures/`, e.g. `"tip-splitter.app.tsx"`. */
  name: string;
  source: string;
}

export interface PromptInputs {
  /** The full text of `docs/sdk-reference.md` (or its `WHIM_SDK_REFERENCE_PATH` override),
   *  embedded verbatim into generate/repair system messages — never re-transcribed. */
  sdkReference: string;
  /** The curated few-shot list, in a stable (sorted-by-name) order. */
  fewShotExamples: FewShotExample[];
}

/** Thrown when a prompt input is missing or empty — always actionable (names the resolved path
 *  and, for the SDK reference, the override variable). */
export class PromptInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptInputError';
  }
}

const SDK_REFERENCE_ENV = 'WHIM_SDK_REFERENCE_PATH';
/** Fixtures that are NOT curated few-shot examples: `latency-probe.app.tsx` deliberately bypasses
 *  the SDK via a raw syscall (design D10) and must never teach the model that shape. */
const EXCLUDED_FEW_SHOT = new Set<string>(['latency-probe.app.tsx']);

function resolvedSdkReferencePath(cwd: string): string {
  const override = process.env[SDK_REFERENCE_ENV];
  if (!override) return path.join(cwd, 'docs', 'sdk-reference.md');
  return path.isAbsolute(override) ? override : path.join(cwd, override);
}

/** Load `docs/sdk-reference.md` (or its override) from disk. Resolved from `cwd` (default
 *  `process.cwd()`), overridable by `WHIM_SDK_REFERENCE_PATH` — the same idiom `main.ts` uses for
 *  `WHIM_DATA_DIR`. */
export function loadSdkReference(cwd: string = process.cwd()): string {
  const refPath = resolvedSdkReferencePath(cwd);
  let text: string;
  try {
    text = fs.readFileSync(refPath, 'utf8');
  } catch (err) {
    throw new PromptInputError(
      `Could not read the vc-sdk reference at "${refPath}" (override with ${SDK_REFERENCE_ENV}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (text.trim().length === 0) {
    throw new PromptInputError(`The vc-sdk reference at "${refPath}" is empty.`);
  }
  return text;
}

/** Load the curated few-shot list: every `fixtures/*.app.tsx` (top-level only — the `adversarial/`
 *  subdirectory is never swept in), excluding `latency-probe.app.tsx`, sorted by name for a stable,
 *  reproducible prompt. */
export function loadFewShotExamples(cwd: string = process.cwd()): FewShotExample[] {
  const fixturesDir = path.join(cwd, 'fixtures');
  let entries: string[];
  try {
    entries = fs.readdirSync(fixturesDir);
  } catch (err) {
    throw new PromptInputError(
      `Could not read the few-shot fixtures directory "${fixturesDir}": ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const names = entries
    .filter((name) => name.endsWith('.app.tsx') && !EXCLUDED_FEW_SHOT.has(name))
    .sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    throw new PromptInputError(
      `No curated few-shot fixtures found under "${fixturesDir}" (excluding ${[...EXCLUDED_FEW_SHOT].join(', ')}).`,
    );
  }
  return names.map((name) => ({ name, source: fs.readFileSync(path.join(fixturesDir, name), 'utf8') }));
}

/** Load both prompt inputs. */
export function loadPromptInputs(cwd: string = process.cwd()): PromptInputs {
  return { sdkReference: loadSdkReference(cwd), fewShotExamples: loadFewShotExamples(cwd) };
}

// ─── Content policy document (spec content-policy "The 13+ content policy has one written
// source") ────────────────────────────────────────────────────────────────────

export interface ContentPolicyDocument {
  /** `docs/content-policy.md`'s `## Rating rule` section body, appended verbatim to the rewrite
   *  and generate system messages (`../prompts/index.ts`). */
  ratingRule: string;
  /** The same document's `## Categories` section body, appended verbatim into the content-policy
   *  classifier's system message (`../../policy/policy.ts`). */
  categories: string;
}

// Keyed by resolved absolute path rather than a single module-level value: `loadContentPolicyDocument`
// is called from inside every rewrite/generate message build (unlike `loadPromptInputs`, which a
// composition root calls once and threads through as a parameter — this loader can't take that
// shape without changing those builders' signatures), so it needs real memoization to avoid a disk
// read per turn, while still letting a test load a DIFFERENT (e.g. deliberately broken) document
// from a different cwd without seeing a stale cache entry.
const contentPolicyCache = new Map<string, ContentPolicyDocument>();

function resolvedContentPolicyPath(cwd: string): string {
  return path.join(cwd, 'docs', 'content-policy.md');
}

/** The heading's body text (from just after `## <heading>` to the next heading of the same or
 *  higher level, or EOF), or `''` when the heading is absent — the caller decides whether an empty
 *  section is an error. */
function markdownSection(doc: string, heading: string): string {
  const lines = doc.split('\n');
  const headingRegex = new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'i');
  const start = lines.findIndex((line) => headingRegex.test(line.trim()));
  if (start === -1) return '';
  const level = (/^#+/.exec(lines[start].trim()) ?? ['##'])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const found = /^(#+)\s/.exec(lines[i]);
    if (found && found[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

/** Load `docs/content-policy.md`, split into its rating-rule and categories sections. Resolved
 *  from `cwd` (default `process.cwd()`), memoized per resolved path. Throws `PromptInputError`
 *  naming the missing section when either is absent or empty — never returns a partial document. */
export function loadContentPolicyDocument(cwd: string = process.cwd()): ContentPolicyDocument {
  const docPath = resolvedContentPolicyPath(cwd);
  const cached = contentPolicyCache.get(docPath);
  if (cached) return cached;

  let text: string;
  try {
    text = fs.readFileSync(docPath, 'utf8');
  } catch (err) {
    throw new PromptInputError(
      `Could not read the content policy document at "${docPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const ratingRule = markdownSection(text, 'Rating rule');
  if (ratingRule.length === 0) {
    throw new PromptInputError(`The content policy document at "${docPath}" has no "Rating rule" section.`);
  }
  const categories = markdownSection(text, 'Categories');
  if (categories.length === 0) {
    throw new PromptInputError(`The content policy document at "${docPath}" has no "Categories" section.`);
  }

  const doc: ContentPolicyDocument = { ratingRule, categories };
  contentPolicyCache.set(docPath, doc);
  return doc;
}
