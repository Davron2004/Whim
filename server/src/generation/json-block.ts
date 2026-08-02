/**
 * server/src/generation/json-block.ts — one tolerant reader for "a model turn that was asked for
 * JSON". Small models fence their JSON as often as not, so every such turn (clarify, rewrite,
 * summarise) needs the same two-step: unwrap an optional ```json fence, then `JSON.parse`.
 *
 * Returns `undefined` rather than throwing: every caller's next step on unparseable output is a
 * decision of its own (a 502, a plain-text fallback, no summary), not an exception to catch.
 */

// No `\s*` alongside `[\s\S]*?` — an unbounded whitespace matcher adjacent to an unbounded dot-all
// matcher over an overlapping character class is a classic catastrophic-backtracking shape; the
// surrounding whitespace is trimmed below instead.
const FENCE = /```(?:json)?([\s\S]*?)```/i;

/** Parse a model turn's text as JSON, tolerating a ```json fenced block. `undefined` = "not JSON". */
export function parseJsonBlock(text: string): unknown {
  const fenced = FENCE.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (candidate.length === 0) return undefined;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}
