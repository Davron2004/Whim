/**
 * whim-prose lexer — the four classes the DEVICE decides, with no model involvement
 * (docs/design/system.md §2.7):
 *
 *   `app`     — a mention of an installed app, matched against the installed-app list
 *   `measure` — anything counted or timed (a number, a duration, a version identifier)
 *   `yours`   — the user's own words, matched against the stored verbatim prompt
 *   `state`   — "ready" or "failed", never another status word
 *
 * A pure function of (text, installed apps, stored prompt): same input, same spans, every run.
 * `chg` and `hedge` are NOT lexed here — they come only from the producer's marks.
 */

import type { ProseApp, Span, WhimClass } from './types';

/** The fixed status vocabulary: the two outcomes the product reports. Any other status word
 *  ("working", "building", "stopped") is NOT a `state`, so the colour never claims an outcome. */
export const STATE_VOCABULARY = ['ready', 'failed'] as const;

/**
 * Render priority, lowest number wins. Overlaps are resolved by dropping the LOWER-priority span
 * whole (never trimming it), and the same order breaks every cap tie:
 *
 *   `yours` — attribution, and exempt from the mark cap, so it can never be crowded out
 *   `app`   — the strongest tie between prose and the grid
 *   `chg`   — the one thing that changed: the point of the sentence
 *   `state` — an outcome word carries meaning its colour reinforces
 *   `measure` — figures only; the words read fine without it
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

/** A letter, digit or combining mark in any script: "caf" is inside "café" (precomposed or with a
 *  combining accent), "таймер" inside "таймеры". The `u` flag's property escapes don't reach the
 *  device as such: the React Native Babel preset (`@babel/plugin-transform-unicode-regex`) expands
 *  them into plain ranges at bundle time. */
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/** True when `[start, end)` is bounded by non-word characters — so "Pour Timer" matches in
 *  "open Pour Timer now" but not inside "Pour Timerish". The characters either side are read
 *  whole, so a letter outside the BMP (a surrogate pair) counts as one. A language that joins
 *  words without a space has no boundary to find: a Korean particle ("타이머를") or Japanese
 *  ("タイマーを") makes the prompt part of a longer word, so it isn't matched there — a known limit,
 *  in the safe direction. */
function isWholeWord(text: string, start: number, end: number): boolean {
  const before = Array.from(text.slice(Math.max(0, start - 2), start)).at(-1);
  const after = Array.from(text.slice(end, end + 2))[0];
  return !isWordChar(before) && !isWordChar(after);
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

/** Every start of `needle` in `text` that sits on word boundaries at both ends, exact case. */
function findWholeWords(text: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return hits;
    if (isWholeWord(text, at, at + needle.length)) {
      hits.push(at);
      from = at + needle.length;
    } else {
      from = at + 1;
    }
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
        spans.push({ cls: 'app', start, end, color: app.color });
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
    const previous = merged.at(-1);
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

/** A hyphen joins a status word into a compound ("ready-made", "failed-over") that reports no
 *  outcome, so for `state` it is part of the word, not a boundary. */
function isStateWord(text: string, start: number, end: number): boolean {
  return isWholeWord(text, start, end) && text[start - 1] !== '-' && text[end] !== '-';
}

function lexStates(text: string): Span[] {
  const spans: Span[] = [];
  for (const word of STATE_VOCABULARY) {
    for (const start of findAll(text, word, true)) {
      const end = start + word.length;
      if (isStateWord(text, start, end)) spans.push({ cls: 'state', start, end });
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

/** `text` lowercased letter by letter, keeping its length: a letter whose lowercase is longer
 *  (`İ`) stays as it is, so every index into the folded text is the same index into `text`. */
function foldCase(text: string): string {
  let folded = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    folded += lower.length === ch.length ? lower : ch;
  }
  return folded;
}

/**
 * `yours` is MATCHED, never reconstructed. Two exact rules:
 *   1. the stored prompt appearing verbatim in the text as whole words (a history row whose
 *      headline IS the user's prompt): in any case when it is two words or more (a keyboard
 *      capitalises the prompt's first letter, a headline may not), in its own case when it is one
 *      word, as a one-word quote is, so a prompt "timer" doesn't claim a "Timer" label or "timers";
 *   2. a quoted run whose contents are an exact substring of the stored prompt: in any case when
 *      the run is two words or more (a summary quoting the prompt mid-sentence lowercases it), in
 *      the prompt's own case and as a whole word of it when it is one word — a capitalised one-word
 *      quote is far more often a label of the app ("Done", "Add") than the person's word, a prompt
 *      holding that word in lowercase doesn't make it theirs, and “do” is not a word of "undo".
 *
 * A paraphrase matches neither and therefore carries no mark — the deliberate failure direction,
 * because the class is attribution and attributing a paraphrase to the user is a lie. The spans
 * index the text as written, so it renders letter for letter as the producer wrote it.
 */
function lexYours(text: string, storedPrompt: string | null | undefined): Span[] {
  const asTyped = (storedPrompt ?? '').trim();
  const prompt = foldCase(asTyped);
  if (prompt.length < 3) return [];
  const folded = foldCase(text);

  const spans: Span[] = [];
  const oneWord = !/\s/.test(asTyped);
  for (const start of findWholeWords(oneWord ? text : folded, oneWord ? asTyped : prompt)) {
    spans.push({ cls: 'yours', start, end: start + prompt.length });
  }

  for (const [innerStart, innerEnd] of quotedRanges(text)) {
    const [start, end] = tightenedRange(text, innerStart, innerEnd);
    if (end <= start) continue;
    const quote = text.slice(start, end);
    const theirs = /\s/.test(quote) ? prompt.includes(folded.slice(start, end)) : findWholeWords(asTyped, quote).length > 0;
    if (theirs) spans.push({ cls: 'yours', start, end });
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
