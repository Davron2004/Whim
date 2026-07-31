/**
 * server/src/generation/prompts/index.ts — message builders for the four model turns (design D10,
 * D11; spec "Prompt assembly has one source of truth per input", "The plan is structured and
 * validated against the request", "Repair asks for a minimal diff with the diagnostics in
 * context"). Pure functions: no disk access (that is `./inputs.ts`'s job) and no model id (that is
 * `../model.ts`'s job) — each builder takes an explicit context object plus, for the two turns
 * that write code, the `PromptInputs` loaded once at composition-root time. Every builder returns
 * `ModelMessage[]`, the provider-agnostic shape `../model.ts` declares.
 */
import type { GenerateRequest, RewriteRequest, Diagnostic } from '@whim/contract';
import type { ModelMessage } from '../model';
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

function requestEditSection(request: GenerateRequest): string {
  if (!request.app) return 'This is a brand-new app: there is no existing install.';
  const lines = [
    request.app.source !== undefined
      ? 'This is an edit. The current TypeScript source is included below under "Current source" — read it before changing anything.'
      : 'This is an edit, but no original TypeScript source is on file for this install (a pre-existing app). ' +
        'Regenerate it honestly from the manifest and schema below — do NOT refer to any code as "your current code".',
    `Current manifest: ${JSON.stringify(request.app.manifest)}`,
    `Current schema: ${JSON.stringify(request.app.schema)}`,
  ];
  return lines.join('\n');
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

// ─── Rewrite turn ────────────────────────────────────────────────────────────

export interface RewriteTurnContext {
  request: RewriteRequest;
}

const REWRITE_SYSTEM = [
  "You rewrite a user's casual request into one clear, specific product description for generating a",
  'tiny app. Reply with the rewritten description ONLY — no preamble, no quotes, no explanation.',
].join(' ');

export function buildRewriteMessages(ctx: RewriteTurnContext): ModelMessage[] {
  return [
    { role: 'system', content: REWRITE_SYSTEM },
    { role: 'user', content: ctx.request.prompt },
  ];
}

// ─── Plan turn ───────────────────────────────────────────────────────────────

export interface PlanTurnContext {
  request: GenerateRequest;
  schemaContext: string;
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
    requestEditSection(ctx.request),
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
}

const GENERATE_INSTRUCTIONS = [
  'Write ONE TypeScript file that default-exports the result of `defineApp({...})`, following the',
  'vc-sdk reference below exactly — never invent a prop, component, or token it does not document.',
  'Follow the validated plan. Reply with the TypeScript source ONLY — no explanation, no markdown fence.',
].join(' ');

export function buildGenerateMessages(ctx: GenerateTurnContext, inputs: PromptInputs): ModelMessage[] {
  const system = nonEmptySections(GENERATE_INSTRUCTIONS, sdkReferenceSection(inputs), fewShotSection(inputs));
  const user = nonEmptySections(
    `Request: ${ctx.request.prompt}`,
    requestEditSection(ctx.request),
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
    schemaContextSection(ctx.schemaContext),
    `Current source:\n${ctx.currentSource}`,
    diagnosticsSection(ctx.diagnostics),
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
