/**
 * whim-prose lexer — the four classes the DEVICE decides, with no model involvement (design D7;
 * app-launcher §"Four Whim Syntax classes are lexed deterministically on the device"):
 *
 *   `app`     — a mention of an installed app, matched against the installed-app list
 *   `measure` — anything counted or timed (a number, a duration, a version identifier)
 *   `yours`   — the user's own words, matched against the stored verbatim prompt
 *   `state`   — the fixed three-word status vocabulary, never a synonym
 *
 * A pure function of (text, installed apps, stored prompt): same input, same spans, every run.
 * `chg` and `hedge` are NOT lexed here — they come only from the producer's marks.
 */

import { appColor } from '../../../sdk/theme';
import type { ProseApp, Span, WhimClass } from './types';

/** The fixed status vocabulary. A synonym ("fine", "failed", "pending") is NOT a `state` — the
 *  class means the product's own three words, so lexing near-misses would make the hue lie. */
export const STATE_VOCABULARY = ['working', 'broken', 'waiting'] as const;

/**
 * Render priority, lowest number wins. Overlaps are resolved by dropping the LOWER-priority span
 * whole (never trimming it), and the same order breaks every cap tie:
 *
 *   `yours` — attribution, and exempt from the mark cap, so it can never be crowded out
 *   `app`   — the strongest tie between prose and the grid
 *   `chg`   — the one thing that changed: the point of the sentence
 *   `state` — a status word carries meaning a hue reinforces
 *   `measure` — face-only; the words read fine without it
 *   `hedge` — detail that is deliberately not the point
 */
export const CLASS_PRIORITY: Readonly<Record<WhimClass, number>> = {
  yours: 0,
  app: 1,
  chg: 2,
  state: 3,
  measure: 4,
  hedge: 5,
};

/** Sort spans into the canonical order: priority, then position, then longest — deterministic for
 *  any input, which is what makes overlap resolution and cap enforcement reproducible. */
export function sortSpans(spans: readonly Span[]): Span[] {
  return [...spans].sort(
    (a, b) =>
      CLASS_PRIORITY[a.cls] - CLASS_PRIORITY[b.cls] ||
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      a.cls.localeCompare(b.cls),
  );
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/** True when `[start, end)` is bounded by non-word characters — so "Pour Timer" matches in
 *  "open Pour Timer now" but not inside "Pour Timerish". */
function isWholeWord(text: string, start: number, end: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end]);
}

function findAll(text: string, needle: string, caseInsensitive: boolean): number[] {
  if (needle.length === 0) return [];
  const haystack = caseInsensitive ? text.toLowerCase() : text;
  const target = caseInsensitive ? needle.toLowerCase() : needle;
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(target, from);
    if (at < 0) return hits;
    hits.push(at);
    from = at + target.length;
  }
}

// ── app ───────────────────────────────────────────────────────────────────────

function lexApps(text: string, apps: readonly ProseApp[]): Span[] {
  const spans: Span[] = [];
  for (const app of apps) {
    const name = app.name.trim();
    if (name.length === 0) continue;
    for (const start of findAll(text, name, true)) {
      const end = start + name.length;
      if (isWholeWord(text, start, end)) {
        spans.push({ cls: 'app', start, end, color: app.color ?? appColor(app.name) });
      }
    }
  }
  return spans;
}

// ── measure ───────────────────────────────────────────────────────────────────

// Ordered, most specific first: a version identifier (`v4`), a clock (`0:45`), a number carrying
// a unit (`30s`, `20%`), then a bare number. An earlier pattern's match wins any overlap, so
// `0:45` is one clock rather than two numbers. The span is the counted TOKEN, not the counted
// noun — "3 taps" marks `3`, because the noun is unbounded vocabulary and guessing at it would
// mark words the user never counted.
const MEASURE_PATTERNS: readonly RegExp[] = [
  /\bv\d+(?:\.\d+)*\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /\b\d+(?:\.\d+)?\s?(?:ms|s|m|h|%)(?![A-Za-z0-9])/g,
  /\b\d+(?:\.\d+)?\b/g,
];

/** Merge measure spans separated by a single space where the left one ends in a unit, so
 *  "3m 30s" is one duration rather than two marks against the sentence's cap. */
function mergeAdjacentMeasures(text: string, spans: readonly Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    const joinable =
      previous !== undefined &&
      span.start === previous.end + 1 &&
      text[previous.end] === ' ' &&
      !/\d/.test(text[previous.end - 1]);
    if (joinable) merged[merged.length - 1] = { ...previous, end: span.end };
    else merged.push(span);
  }
  return merged;
}

function lexMeasures(text: string): Span[] {
  const spans: Span[] = [];
  for (const pattern of MEASURE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (!spans.some((kept) => start < kept.end && kept.start < end)) {
        spans.push({ cls: 'measure', start, end });
      }
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return mergeAdjacentMeasures(text, spans);
}

// ── state ─────────────────────────────────────────────────────────────────────

function lexStates(text: string): Span[] {
  const spans: Span[] = [];
  for (const word of STATE_VOCABULARY) {
    for (const start of findAll(text, word, true)) {
      const end = start + word.length;
      if (isWholeWord(text, start, end)) spans.push({ cls: 'state', start, end });
    }
  }
  return spans;
}

// ── yours ─────────────────────────────────────────────────────────────────────

// Typographic and straight double quotes. Scanned by index rather than matched by regex: a
// quote pattern over free-form prose backtracks on every unbalanced quote mark, and `indexOf`
// has no such cliff.
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['“', '”'],
  ['"', '"'],
];

/** The `[start, end)` ranges INSIDE each balanced pair of quotes. */
function quotedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let from = 0;
    for (;;) {
      const start = text.indexOf(open, from);
      if (start < 0) break;
      const end = text.indexOf(close, start + 1);
      if (end < 0) break;
      ranges.push([start + 1, end]);
      from = end + 1;
    }
  }
  return ranges;
}

/** Trim whitespace off `[start, end)` and return the tightened range. */
function tightenedRange(text: string, start: number, end: number): [number, number] {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  return [from, to];
}

/**
 * `yours` is MATCHED, never reconstructed. Two exact rules, both case-sensitive:
 *   1. the stored prompt appearing verbatim in the text (a history row whose headline IS the
 *      user's prompt), and
 *   2. a quoted run whose contents are an exact substring of the stored prompt.
 *
 * A paraphrase matches neither and therefore carries no mark — the deliberate failure direction,
 * because the class is attribution and attributing a paraphrase to the user is a lie.
 */
function lexYours(text: string, storedPrompt: string | null | undefined): Span[] {
  const prompt = (storedPrompt ?? '').trim();
  if (prompt.length < 3) return [];

  const spans: Span[] = [];
  for (const start of findAll(text, prompt, false)) {
    spans.push({ cls: 'yours', start, end: start + prompt.length });
  }

  for (const [innerStart, innerEnd] of quotedRanges(text)) {
    const [start, end] = tightenedRange(text, innerStart, innerEnd);
    if (end > start && prompt.includes(text.slice(start, end))) {
      spans.push({ cls: 'yours', start, end });
    }
  }
  return spans;
}

// ── the lexer ─────────────────────────────────────────────────────────────────

/**
 * The device-side lexer: pure, deterministic, no model involvement. Returns every candidate span
 * in canonical order — overlap resolution and the discipline caps are the RENDERER's job
 * (`render.ts`), so the lexer never has to know how much room a sentence has left.
 */
export function lexProse(
  text: string,
  apps: readonly ProseApp[] = [],
  storedPrompt?: string | null,
): Span[] {
  if (text.length === 0) return [];
  return sortSpans([
    ...lexYours(text, storedPrompt),
    ...lexApps(text, apps),
    ...lexMeasures(text),
    ...lexStates(text),
  ]);
}
