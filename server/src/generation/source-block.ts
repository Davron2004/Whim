/**
 * server/src/generation/source-block.ts — one tolerant reader for "a model turn that was asked
 * for bare TypeScript source". The generate/repair prompts say "no markdown fence", but some
 * models wrap the reply in a ```typescript fence anyway even when told not to (observed live on
 * deepseek/deepseek-v4.1-flash). Mirrors json-block.ts's tolerance: an optional leading fence, and
 * a MISSING closing fence is tolerated too — a reply truncated (context limit, a dropped
 * connection) before the fence closes still has its source captured here rather than failing the
 * static check and burning a repair round on the fence itself (whose reply may fence again).
 *
 * Only a LEADING fence counts. A fence appearing later in the text is left alone, because a
 * template literal inside the generated source can legitimately contain a ``` sequence — this
 * module never scans past where it stops looking for an opener. At most a short (<=3 line) prose
 * preamble before the fence is tolerated ("Here is the app:\n```ts\n..."); beyond that, or when no
 * fence is found at all, the text is returned completely unchanged — this module never trims, so
 * the unfenced path is byte-identical to its input.
 */

const MAX_PREAMBLE_LINES = 3;
const FENCE_OPEN = /^```(?:ts|tsx|typescript|javascript|jsx)?[ \t]*$/i;
const FENCE_CLOSE = /^```[ \t]*$/;

/** Unwrap an optional leading ```/```ts-style fence from a model turn's source reply, tolerating
 *  a missing closing fence and up to a 3-line prose preamble before the opener. Returns the text
 *  unchanged (no trim) when no leading fence is found. */
export function unwrapSourceFence(text: string): string {
  const leadingTrimmed = text.replace(/^[ \t\r\n]+/, '');
  const lines = leadingTrimmed.split(/\r?\n/);
  for (let openLine = 0; openLine <= MAX_PREAMBLE_LINES && openLine < lines.length; openLine++) {
    if (!FENCE_OPEN.test(lines[openLine])) continue;
    const body = lines.slice(openLine + 1);
    if (body.length > 0 && FENCE_CLOSE.test(body[body.length - 1])) body.pop();
    return body.join('\n');
  }
  return text;
}
