/**
 * server/src/generation/plan.ts — the internal `Plan` shape (design D11), a fenced-block-tolerant
 * parser for the model's JSON skeleton, and mechanical validation against the request (spec "The
 * plan is structured and validated against the request"). The plan never crosses the wire — this
 * module is pipeline-internal; `machine.ts` is the only caller.
 *
 * Every validation rule is decidable, never a judgement call (design D11): initial ∈ screens,
 * unique non-empty screen names, capabilities ⊆ the harness's known set, storage keys only with the
 * storage capability, and — for an edit — no dropped capability the supplied applied schema
 * requires. `KNOWN_CAPABILITIES` mirrors `prompts/index.ts`'s `PLAN_SYSTEM` message verbatim
 * ("storage", "cues") — both read `checks/contract.ts`'s `CAPABILITY_EXPORTS`, the SDK-facade-backed
 * capability set a generated app can actually declare (the bridge registry's `diag` capability has
 * no SDK facade and is never model-generatable here, so it is deliberately excluded).
 */
import { CAPABILITY_EXPORTS } from '../../../checks/contract';
import type { GenerateRequest } from '@whim/contract';

export interface Plan {
  screens: { name: string; purpose: string }[];
  initial: string;
  state: string[];
  capabilities: string[];
  storageKeys: string[];
}

export interface PlanParseSuccess {
  ok: true;
  plan: Plan;
}
export interface PlanParseFailure {
  ok: false;
  reason: string;
}
export type PlanParseResult = PlanParseSuccess | PlanParseFailure;

export interface PlanValidationSuccess {
  ok: true;
}
export interface PlanValidationFailure {
  ok: false;
  reason: string;
}
export type PlanValidationResult = PlanValidationSuccess | PlanValidationFailure;

const STORAGE_CAPABILITY = 'storage';
const KNOWN_CAPABILITIES = new Set(CAPABILITY_EXPORTS.map((row) => row.capability));

// No `\s*` alongside `[\s\S]*?` — an unbounded whitespace matcher adjacent to an unbounded
// dot-all matcher over an overlapping character class is a classic catastrophic-backtracking
// shape; the surrounding whitespace is trimmed below instead.
const FENCE = /```(?:json)?([\s\S]*?)```/i;

function isScreen(v: unknown): v is { name: string; purpose: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).name === 'string' &&
    typeof (v as Record<string, unknown>).purpose === 'string'
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((el) => typeof el === 'string');
}

function shapePlan(value: unknown): PlanParseResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'The plan response was not a JSON object.' };
  }
  const v = value as Record<string, unknown>;

  if (!Array.isArray(v.screens) || !v.screens.every(isScreen)) {
    return { ok: false, reason: 'The plan\'s "screens" field must be an array of {name, purpose}.' };
  }
  if (typeof v.initial !== 'string') {
    return { ok: false, reason: 'The plan\'s "initial" field must be a string.' };
  }
  if (!isStringArray(v.state)) {
    return { ok: false, reason: 'The plan\'s "state" field must be an array of strings.' };
  }
  if (!isStringArray(v.capabilities)) {
    return { ok: false, reason: 'The plan\'s "capabilities" field must be an array of strings.' };
  }
  if (!isStringArray(v.storageKeys)) {
    return { ok: false, reason: 'The plan\'s "storageKeys" field must be an array of strings.' };
  }

  return {
    ok: true,
    plan: {
      screens: v.screens as { name: string; purpose: string }[],
      initial: v.initial,
      state: v.state,
      capabilities: v.capabilities,
      storageKeys: v.storageKeys,
    },
  };
}

/**
 * Extracts the model's JSON skeleton, tolerating an optional ```json fenced block (the shape
 * `prompts/index.ts`'s `buildPlanMessages` asks for), then validates its raw structure (every
 * field present, correctly typed). Business-rule validation is `validatePlan`'s job.
 */
export function parsePlan(text: string): PlanParseResult {
  const fenced = FENCE.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (candidate.length === 0) return { ok: false, reason: 'The plan response was empty.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: 'The plan response was not valid JSON.' };
  }

  return shapePlan(parsed);
}

/** Mechanical validation against the request (design D11) — every rule is decidable. */
export function validatePlan(plan: Plan, request: GenerateRequest): PlanValidationResult {
  const names = plan.screens.map((s) => s.name);

  if (names.some((n) => n.trim().length === 0)) {
    return { ok: false, reason: 'Every screen must have a non-empty name.' };
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) duplicates.add(n);
    seen.add(n);
  }
  if (duplicates.size > 0) {
    return { ok: false, reason: `Screen names must be unique — repeated: ${[...duplicates].join(', ')}.` };
  }

  if (!names.includes(plan.initial)) {
    return {
      ok: false,
      reason: `The initial screen "${plan.initial}" does not name any declared screen (${names.join(', ') || 'none declared'}).`,
    };
  }

  const unknownCapabilities = plan.capabilities.filter((c) => !KNOWN_CAPABILITIES.has(c));
  if (unknownCapabilities.length > 0) {
    return {
      ok: false,
      reason: `Unknown capabilit${unknownCapabilities.length === 1 ? 'y' : 'ies'}: ${unknownCapabilities.join(', ')}.`,
    };
  }

  if (plan.storageKeys.length > 0 && !plan.capabilities.includes(STORAGE_CAPABILITY)) {
    return {
      ok: false,
      reason: 'Storage keys are declared but the "storage" capability is not — add it or drop the keys.',
    };
  }

  const appliedSchema = request.app?.appliedSchema;
  if (
    appliedSchema &&
    Object.keys(appliedSchema).length > 0 &&
    !plan.capabilities.includes(STORAGE_CAPABILITY)
  ) {
    return {
      ok: false,
      reason: 'This app already has stored data, but the plan drops the "storage" capability.',
    };
  }

  return { ok: true };
}
