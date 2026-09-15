/**
 * server/src/policy/input.ts — the canonical, per-route content-policy input (spec "The check
 * covers all user-authored text in the request"): exactly the user-authored free text each route's
 * request carries, framed as one deterministic JSON string. The SAME string is both what the
 * classifier judges (wrapped in a data block by `policy.ts`) and the cache-key material (hashed
 * whole, by `cache.ts`) — "canonical" means the field order is fixed by this module, never by
 * object/iteration order at a call site.
 *
 * Deliberately excludes `source`, bundles, manifests, schemas and applied schemas (spec: that code
 * was already produced by an earlier, checked generation, so sending it would multiply cost
 * without adding user intent).
 */
import type { ClarifyRequest, GenerateRequest, RewriteRequest } from '@whim/contract';

interface CanonicalFields {
  prompt: string;
  clarifications: { question: string; answer: string }[];
  appName: string | null;
  fields: string[];
}

function canonicalize(fields: CanonicalFields): string {
  return JSON.stringify({
    prompt: fields.prompt,
    clarifications: fields.clarifications,
    appName: fields.appName,
    fields: fields.fields,
  });
}

/** `/v1/clarify`: only the prompt is user-authored free text at this point in the flow — no
 *  clarification answers exist yet, and the spec scopes app-name/collection-name checking to
 *  rewrite alone. */
export function buildClarifyPolicyInput(request: ClarifyRequest): string {
  return canonicalize({ prompt: request.prompt, clarifications: [], appName: null, fields: [] });
}

/** `/v1/rewrite`: the prompt, every clarification's question and answer, and — because a rewrite
 *  can carry a user-typed app name and collection/field names — those display names too (spec "App
 *  names in a rewrite are checked"). */
export function buildRewritePolicyInput(request: RewriteRequest): string {
  const collections = request.app?.collections ?? [];
  return canonicalize({
    prompt: request.prompt,
    clarifications: (request.clarifications ?? []).map((c) => ({ question: c.question, answer: c.answer })),
    appName: request.app?.name ?? null,
    fields: collections.flatMap((c) => [c.name, ...c.fields]),
  });
}

/** `/v1/generate`: the prompt and every clarification's question and answer. `GenerateRequest.app`
 *  carries no display names (only `source`/`manifest`/`schema`, all excluded on purpose), so there
 *  is nothing else to add. */
export function buildGeneratePolicyInput(request: GenerateRequest): string {
  return canonicalize({
    prompt: request.prompt,
    clarifications: (request.clarifications ?? []).map((c) => ({ question: c.question, answer: c.answer })),
    appName: null,
    fields: [],
  });
}
