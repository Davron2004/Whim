/**
 * server/src/generation/prompts/index.ts — message builders for every model turn (design D10,
 * D11; spec "Prompt assembly has one source of truth per input", "The plan is structured and
 * validated against the request", "Repair asks for a minimal diff with the diagnostics in
 * context"). Pure functions: no disk access (that is `./inputs.ts`'s job) and no model id (that is
 * `../model.ts`'s job) — each builder takes an explicit context object plus, for the two turns
 * that write code, the `PromptInputs` loaded once at composition-root time. Every builder returns
 * `ModelMessage[]`, the provider-agnostic shape `../model.ts` declares.
 */
import type { AppContext, Clarification, ClarifyRequest, GenerateRequest, RewriteRequest, Diagnostic } from '@whim/contract';
import type { ModelMessage } from '../model';
import type { SummariserInput } from '../summarise';
import type { PromptInputs } from './inputs';

// ─── The plan shape prompts render (design D11's `Plan`, mirrored structurally — chain-4's
// server/src/generation/plan.ts owns the canonical validated type; this module only renders one) ──

export interface PromptPlan {
  screens: { name: string; purpose: string }[];
  initial: string;
  state: string[];
  capabilities: string[];
  storageKeys: string[];
}

// ─── Shared rendering helpers ────────────────────────────────────────────────

/**
 * `sourceRendered` is whether THIS turn goes on to render the `Current source:` block — the plan
 * turn deliberately does not (design D2: it does not need the whole source and paying its tokens
 * twice per run is waste). The claim "the source is included below" is made only when it is true
 * (spec "The edit turn sees the app it is changing": the prompt SHALL NOT state that source is
 * included when it is not), so this flag is not decoration — it is what keeps the prompt honest.
 */
function editOpeningLine(sourceOnFile: boolean, sourceRendered: boolean): string {
  if (!sourceOnFile) {
    return (
      'This is an edit, but no original TypeScript source is on file for this install (a pre-existing app). ' +
      'Regenerate it honestly from the manifest and schema below — do NOT refer to any code as "your current code".'
    );
  }
  return sourceRendered
    ? 'This is an edit. The current TypeScript source is included below under "Current source" — read it before changing anything.'
    : 'This is an edit of an app the user already has installed.';
}

function requestEditSection(request: GenerateRequest, sourceRendered: boolean): string {
  if (!request.app) return 'This is a brand-new app: there is no existing install.';
  const lines = [
    editOpeningLine(request.app.source !== undefined, sourceRendered),
    `Current manifest: ${JSON.stringify(request.app.manifest)}`,
    `Current schema: ${JSON.stringify(request.app.schema)}`,
  ];
  return lines.join('\n');
}

/** The one shape "here is the code" takes, whichever turn renders it — the generate turn's
 *  pre-flighted `app.source` and the repair turn's failing candidate use the same heading. */
function currentSourceSection(source: string): string {
  return `Current source:\n${source}`;
}

/** The identity half of edit continuity (spec "The edit turn sees the app it is changing").
 *  Carried by every turn for a request with an `app`, source on file or not: an honest
 *  regeneration must preserve the app's identity just as much as an edit that can read the code. */
const IDENTITY_CONTINUITY = [
  "Continuity — this app already exists and holds the user's data:",
  '- Keep the app\'s current name unless this request explicitly asks to rename it.',
  "- Every concept that already exists keeps the collection and field IDs it already has: the user's",
  '  rows are stored under those IDs, and a different ID is a different, empty table or column.',
].join('\n');

function identityContinuitySection(request: GenerateRequest): string {
  return request.app ? IDENTITY_CONTINUITY : '';
}

/** The storage half of edit continuity. `storageSurface` is the location list rendered by the
 *  machine from the ONE per-run `scanStorageSurface` result (design D3: the same value the static
 *  checker takes as its drift baseline) — empty for a new app, or for an edit whose source is
 *  absent or failed pre-flight, and then no section is rendered at all. */
function storageSurfaceSection(storageSurface: string | undefined): string {
  if (!storageSurface || storageSurface.trim().length === 0) return '';
  return (
    `Storage locations the app being edited reads and writes:\n${storageSurface}\n` +
    "Keep reading and writing these exact locations — the user's existing data lives there. Add a new " +
    'location when the change needs one; never replace or rename an existing one.'
  );
}

function planSection(plan: PromptPlan): string {
  return `Validated plan:\n${JSON.stringify(plan)}`;
}

function schemaContextSection(schemaContext: string): string {
  return schemaContext.trim().length > 0 ? `Storage field-ID constraints:\n${schemaContext}` : '';
}

function diagnosticLine(d: Diagnostic): string {
  const location = d.line !== undefined ? ` (line ${d.line})` : '';
  return `- [${d.severity ?? 'error'}] ${d.kind}${location}: ${d.message ?? ''} — ${d.hint}`;
}

function diagnosticsSection(diagnostics: Diagnostic[]): string {
  const rendered = diagnostics.map(diagnosticLine).join('\n');
  return `Diagnostics to fix, errors first, verbatim:\n${rendered}`;
}

function fewShotSection(inputs: PromptInputs): string {
  return inputs.fewShotExamples
    .map((ex) => `--- Example: ${ex.name} ---\n${ex.source}`)
    .join('\n\n');
}

function sdkReferenceSection(inputs: PromptInputs): string {
  return inputs.sdkReference;
}

function nonEmptySections(...sections: string[]): string {
  return sections.filter((s) => s.trim().length > 0).join('\n\n');
}

/** The clarify exchange's answers, rendered for any turn that should reflect them. Empty (and
 *  absent) mean the same thing — the user answered nothing — and render as no section at all. */
function clarificationsSection(clarifications: Clarification[] | undefined): string {
  if (!clarifications || clarifications.length === 0) return '';
  const rows = clarifications.map((c) => `- ${c.question} → ${c.answer}`).join('\n');
  return `The user already answered these questions — honour every answer:\n${rows}`;
}

// ─── Rewrite turn ────────────────────────────────────────────────────────────

export interface RewriteTurnContext {
  request: RewriteRequest;
}

/** The app a request is CHANGING, stated in the user's own vocabulary (spec "A rewrite for an edit
 *  carries the app it is changing") — shared by the rewrite AND clarify turns, since both need the
 *  same "this is an edit, not a new app" facts. `AppContext` is display names (plus an optional
 *  plain-words `description`) only — no source, no burned ids, no records — so this section can
 *  say what the app is called, what it already keeps, and what it currently does, and nothing
 *  more. Absent for a new app, which then carries no continuity language at all. The instruction
 *  itself lives in each turn's system prompt; this section is the facts it acts on. */
function appContextSection(app: AppContext | undefined): string {
  if (!app) return '';
  const collections = (app.collections ?? []).filter((c) => c.name.trim().length > 0);
  const collectionLine = (c: { name: string; fields: string[] }): string =>
    c.fields.length > 0 ? `- ${c.name}: ${c.fields.join(', ')}` : `- ${c.name}`;
  const kept =
    collections.length > 0
      ? '\nIt already keeps track of:\n' + collections.map(collectionLine).join('\n')
      : '';
  const described = app.description && app.description.trim().length > 0
    ? `\nIt is currently described as: ${app.description.trim()}`
    : '';
  return `This request changes an app the user already has, called "${app.name}".${kept}${described}`;
}

/** The four labels the plan screen renders (design D10). The rewrite model is asked for exactly
 *  these rows; a model that returns none stays conforming (the device renders the prompt itself). */
export const PLAN_ROW_LABELS: readonly string[] = [
  'What it is',
  'The screen',
  'When a step ends',
  'What it remembers',
];

const REWRITE_SYSTEM = [
  "You rewrite a user's casual request into one clear, specific product description for generating a",
  'tiny app. Reply with ONLY a JSON object (optionally inside a ```json fenced block) shaped exactly',
  'like: { "rewrittenPrompt": string, "plan": [{ "label": string, "text": string }] }.',
  `Use exactly these plan labels, in order: ${PLAN_ROW_LABELS.map((label) => JSON.stringify(label)).join(', ')}.`,
  "Write both fields in the user's own words: no SDK names, no component names, no engineering",
  'internals, no code.',
  'When the request changes an app that already exists, its current name and what it already keeps',
  'track of are stated with it: keep that name unless the request explicitly asks to rename it, keep',
  'every concept it already has, and describe ONLY what this request changes — never describe the',
  'app as if it were being built from nothing.',
].join(' ');

export function buildRewriteMessages(ctx: RewriteTurnContext): ModelMessage[] {
  return [
    { role: 'system', content: REWRITE_SYSTEM },
    {
      role: 'user',
      content: nonEmptySections(
        ctx.request.prompt,
        appContextSection(ctx.request.app),
        clarificationsSection(ctx.request.clarifications),
      ),
    },
  ];
}

// ─── Clarify turn ────────────────────────────────────────────────────────────

export interface ClarifyTurnContext {
  request: ClarifyRequest;
}

const CLARIFY_SYSTEM = [
  'A user asked for a tiny app. Ask ONLY for what you genuinely cannot guess and what would change',
  'the app if answered differently. Reply with ONLY a JSON object (optionally inside a ```json',
  'fenced block) shaped exactly like:',
  '{ "questions": [{ "id": string, "question": string, "options": [string, ...] }] }.',
  'At most THREE questions, each with two to four short answer options. If nothing genuinely needs',
  'clarifying, return an empty "questions" list — that is a good answer, not a failure. Write in',
  "the user's own words: no SDK names, no component names, no engineering internals.",
  'When the request changes an app the user already has, the app is described with it. Never ask',
  'what the app is, what kind of app it is, or who it is for: that is settled. Ask only about the',
  'change itself, and only if the answer would change what gets built. If the change is clear,',
  'return an empty list.',
].join(' ');

export function buildClarifyMessages(ctx: ClarifyTurnContext): ModelMessage[] {
  return [
    { role: 'system', content: CLARIFY_SYSTEM },
    {
      role: 'user',
      content: nonEmptySections(ctx.request.prompt, appContextSection(ctx.request.app)),
    },
  ];
}

// ─── Summary turn ────────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = [
  'You describe what just happened to a tiny app, for the person who asked for it. Reply with ONLY',
  'a JSON object (optionally inside a ```json fenced block) shaped exactly like:',
  '{ "text": string, "kind": string, "touched": [string], "chg": string, "hedge": string }.',
  '"text" is ONE sentence in sentence case, no exclamation mark, saying what the app now does or no',
  'longer does — the outcome the user can see, never how it was built: no stage names, no commit',
  'ids, no model names, no file names, no error codes. Acknowledge a problem at most once.',
  '"kind" is exactly one of: Start, Added, Changed, Removed, Look, Fixed.',
  '"touched" names the areas affected in plain words (never file names or symbols).',
  '"chg" is the exact substring of "text" naming what changed; "hedge" is the exact substring you',
  'are least sure of — omit either when it does not apply. One vivid word is allowed only if it is',
  'no longer than the plain wording.',
].join(' ');

export function buildSummaryMessages(input: SummariserInput): ModelMessage[] {
  const learned =
    input.diagnostics.length > 0
      ? `Problems found and fixed along the way: ${input.diagnostics.map((d) => d.hint).join(' | ')}`
      : '';
  return [
    { role: 'system', content: SUMMARY_SYSTEM },
    {
      role: 'user',
      content: nonEmptySections(
        `The user asked: ${input.prompt}`,
        input.isEdit ? 'This changed an app they already had.' : 'This built them a new app.',
        `The app is called "${input.appName}".`,
        input.capabilities.length > 0 ? `It can use: ${input.capabilities.join(', ')}.` : '',
        input.attempts > 1 ? `It took ${input.attempts} tries to get right.` : '',
        learned,
      ),
    },
  ];
}

// ─── Plan turn ───────────────────────────────────────────────────────────────

export interface PlanTurnContext {
  request: GenerateRequest;
  schemaContext: string;
  /** The rendered storage-location list — see `GenerateTurnContext.storageSurface`. */
  storageSurface?: string;
  /** Set only on a plan re-ask (spec "the plan SHALL be re-asked once with that reason"). */
  priorFailureReason?: string;
}

const PLAN_SYSTEM = [
  'You are planning a tiny Whim mini-app before any code is written. Reply with ONLY a JSON object',
  '(optionally inside a ```json fenced block) shaped exactly like:',
  '{ "screens": [{ "name": string, "purpose": string }], "initial": string, "state": string[],',
  '  "capabilities": string[], "storageKeys": string[] }',
  'Rules: "initial" must name one of "screens"; screen names are unique and non-empty;',
  '"capabilities" must be a subset of the harness\'s known capability set ("storage", "cues");',
  '"storageKeys" may be non-empty only if "capabilities" includes "storage".',
].join('\n');

export function buildPlanMessages(ctx: PlanTurnContext): ModelMessage[] {
  const userContent = nonEmptySections(
    `Request: ${ctx.request.prompt}`,
    clarificationsSection(ctx.request.clarifications),
    // `false`: the plan turn never renders the source block, so it never claims to (design D2).
    requestEditSection(ctx.request, false),
    identityContinuitySection(ctx.request),
    storageSurfaceSection(ctx.storageSurface),
    schemaContextSection(ctx.schemaContext),
    ctx.priorFailureReason
      ? `Your previous plan was rejected: ${ctx.priorFailureReason}\nReturn a corrected plan.`
      : '',
  );
  return [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: userContent },
  ];
}

// ─── Generate turn ───────────────────────────────────────────────────────────

export interface GenerateTurnContext {
  request: GenerateRequest;
  plan: PromptPlan;
  schemaContext: string;
  /** The storage locations the app being edited reads and writes, already rendered one per line by
   *  the machine from its single per-run `scanStorageSurface` result (design D3). Absent/empty for
   *  a new app and for an edit with no pre-flighted source. */
  storageSurface?: string;
}

const GENERATE_INSTRUCTIONS = [
  'Write ONE TypeScript file that default-exports the result of `defineApp({...})`, following the',
  'vc-sdk reference below exactly — never invent a prop, component, or token it does not document.',
  'Follow the validated plan. Reply with the TypeScript source ONLY — no explanation, no markdown fence.',
  // Without this, generated apps default to bare, unstyled layouts and lose settings on reopen —
  // both read as broken to a user even though nothing failed. Naming the concrete components and
  // the storage discipline up front (rather than leaving "make it look nice" implicit) is what
  // actually changes what the model writes.
  'Make the app look finished the moment it opens: sensible defaults instead of empty states, the',
  'main content inside a Card, the headline number as display-size Text, a ProgressBar for anything',
  'that progresses, a Badge for the current status, and a SegmentedControl for presets or modes.',
  'Every user-adjustable setting is persisted with storage.kv under a SHORT LITERAL string key',
  '(never a computed or aliased key), loaded once on mount and saved on every change, so the app',
  'reopens exactly as the user left it. When this is an edit of an existing app, keep every existing',
  'storage.kv key and every existing records collection and field exactly as they are, and keep the',
  'existing layout and controls recognisable — add to the app, do not redesign it.',
].join(' ');

export function buildGenerateMessages(ctx: GenerateTurnContext, inputs: PromptInputs): ModelMessage[] {
  const system = nonEmptySections(GENERATE_INSTRUCTIONS, sdkReferenceSection(inputs), fewShotSection(inputs));
  // Already pre-flighted by the composition root, so "present" here means "real, parseable source
  // that declares a default-exported defineApp" — the only kind worth showing the model.
  const currentSource = ctx.request.app?.source;
  const user = nonEmptySections(
    `Request: ${ctx.request.prompt}`,
    clarificationsSection(ctx.request.clarifications),
    requestEditSection(ctx.request, currentSource !== undefined),
    currentSource !== undefined ? currentSourceSection(currentSource) : '',
    identityContinuitySection(ctx.request),
    storageSurfaceSection(ctx.storageSurface),
    planSection(ctx.plan),
    schemaContextSection(ctx.schemaContext),
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─── Repair turn ─────────────────────────────────────────────────────────────

export interface RepairTurnContext {
  request: GenerateRequest;
  plan: PromptPlan;
  currentSource: string;
  /** Ordered errors-first by the caller; rendered verbatim in that order. */
  diagnostics: Diagnostic[];
  schemaContext: string;
  /** The rendered storage-location list — see `GenerateTurnContext.storageSurface`. It describes
   *  the app being edited, not the candidate below, so a repair round still has to preserve it. */
  storageSurface?: string;
}

const REPAIR_INSTRUCTIONS = [
  'The candidate below failed a check. Make the MINIMAL change that fixes every diagnostic listed —',
  'do not rewrite unrelated code. Reply with the FULL corrected TypeScript source ONLY — no',
  'explanation, no markdown fence.',
].join(' ');

export function buildRepairMessages(ctx: RepairTurnContext, inputs: PromptInputs): ModelMessage[] {
  const system = nonEmptySections(REPAIR_INSTRUCTIONS, sdkReferenceSection(inputs), fewShotSection(inputs));
  const user = nonEmptySections(
    `Request: ${ctx.request.prompt}`,
    planSection(ctx.plan),
    storageSurfaceSection(ctx.storageSurface),
    schemaContextSection(ctx.schemaContext),
    currentSourceSection(ctx.currentSource),
    diagnosticsSection(ctx.diagnostics),
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
