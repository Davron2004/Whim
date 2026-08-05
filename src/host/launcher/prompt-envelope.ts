/**
 * prompt-envelope — the launcher-local shape wrapping a version's stored prompt (design D4;
 * shell-redesign-v2 design D3).
 *
 * A version's stored prompt (Snapshot.prompt) may be the CURRENT envelope `{v: 2, text, summary?}`,
 * the earlier `{v: 1, text}`, or a raw legacy string (older seeded fixtures). Every one of those is
 * a legitimate state: an older envelope resolves to its prompt text with no summary, and nothing
 * migrates.
 *
 * `text` keeps its exact meaning across the bump — the VERBATIM approved prompt — so the shell can
 * echo the user's own words rather than reconstruct them. The run's summary rides beside it rather
 * than overwriting it; `history-logic.ts#storedSummary` reads that field structurally off the same
 * JSON, so the two modules never have to agree on a summary type.
 *
 * This module is launcher-local, NOT `contract/` — the RN app must not grow a workspace import
 * (guard:metro seam). `@whim/contract` is a TYPE-ONLY import here for the same reason.
 */

import type { RunSummary } from '@whim/contract';

/** The envelope version this build writes. Monotonic: a new field bumps it (design D3). */
export const PROMPT_ENVELOPE_VERSION = 2;

/** The versions a reader accepts. `1` predates the summary field and carries none. */
const READABLE_VERSIONS: readonly number[] = [1, 2];

export interface PromptEnvelope {
  text: string;
}

/**
 * Serialize the tracked prompt for a delivered generation: `{v: 2, text, summary?}`. `text` is
 * stored verbatim; `summary` is written only when the run's terminal event carried one (its
 * absence is a legitimate state, never an emitter defect). The per-snapshot lineage stamp stays a
 * commit trailer OUTSIDE this envelope and is never written into it.
 */
export function promptEnvelope(text: string, summary?: RunSummary): string {
  return JSON.stringify(
    summary === undefined
      ? { v: PROMPT_ENVELOPE_VERSION, text }
      : { v: PROMPT_ENVELOPE_VERSION, text, summary },
  );
}

/**
 * Strict-parse `raw` as envelope JSON (`v` of 1 or 2, `text` a string). Any parse failure or shape
 * mismatch (not an object, an unknown version, non-string `text`) falls back to `{text: raw}` —
 * the raw string rendered unchanged. Never throws (History's "does not error" requirement).
 */
export function parsePromptEnvelope(raw: string): PromptEnvelope {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      READABLE_VERSIONS.includes((parsed as Record<string, unknown>).v as number) &&
      typeof (parsed as Record<string, unknown>).text === 'string'
    ) {
      return { text: (parsed as { text: string }).text };
    }
  } catch {
    // not JSON at all — fall through to the raw fallback below.
  }
  return { text: raw };
}
