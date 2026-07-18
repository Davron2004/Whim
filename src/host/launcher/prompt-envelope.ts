/**
 * prompt-envelope — the launcher-local shape wrapping a version's stored prompt (design D4).
 *
 * A version's stored prompt (Snapshot.prompt) may be JSON envelope `{v: 1, text: string}`
 * (new-style, honest structured prompt) or a raw legacy string (older seeded fixtures). This
 * module is launcher-local, NOT `contract/` — the RN app must not grow a workspace import
 * (guard:metro seam). #7/#11 will surface this shape in `@whim/contract` later and must
 * conform to it.
 */

export interface PromptEnvelope {
  text: string;
}

/**
 * Strict-parse `raw` as envelope JSON `{v: 1, text: string}`. Any parse failure or shape
 * mismatch (not an object, `v !== 1`, non-string `text`) falls back to `{text: raw}` — the
 * raw string rendered unchanged. Never throws (History's "does not error" requirement).
 */
export function parsePromptEnvelope(raw: string): PromptEnvelope {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).v === 1 &&
      typeof (parsed as Record<string, unknown>).text === 'string'
    ) {
      return { text: (parsed as { text: string }).text };
    }
  } catch {
    // not JSON at all — fall through to the raw fallback below.
  }
  return { text: raw };
}
