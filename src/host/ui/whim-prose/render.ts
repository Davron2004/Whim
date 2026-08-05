/**
 * whim-prose renderer — ONE shared renderer for every piece of machine-written prose on the shell
 * surface (design D7; app-launcher §"Shell prose renders through one shared Whim Syntax
 * renderer"). Per-screen highlighting is the failure this module exists to prevent: the rule set
 * IS the feature, and five copies of it diverge on the first deadline.
 *
 * The discipline rules are enforced HERE, not merely prompted for, because a prompt is not a
 * guarantee and the failure mode is invisible:
 *
 *   1. four system marks per sentence, hard cap
 *   2. `yours` is exempt from that cap, and is the only span carrying two channels
 *   3. one channel per span (by construction — a span has exactly one class)
 *   4. one colour per sentence
 *   7. agent prose only — a string from the copy table is an OFFERING and never marked
 *
 * A mark that a cap rejects is dropped WHOLE, to flat text. Nothing is ever truncated mid-span:
 * concatenating the returned segments always reproduces the input text exactly.
 */

import { SHELL_COLORS, STATUS_COLORS, STATUS_COLORS_ON_INK } from '../../../sdk/theme';
import { COPY } from '../../launcher/copy';
import { lexProse, sortSpans } from './lex';
import type { Mark, ProseApp, ProseSegment, Span, WhimClass } from './types';

/** Rule 1: above four marks readers stop trusting marks and read everything — worse than none. */
export const MAX_SYSTEM_MARKS_PER_SENTENCE = 4;

/** The classes that spend the sentence's one colour. `hedge`'s `faint` grey is de-emphasis — a
 *  reverse highlight, not a hue competing for attention — so it does not spend it. */
const COLOURED_CLASSES: ReadonlySet<WhimClass> = new Set<WhimClass>(['yours', 'app', 'state']);

export interface RenderProseOptions {
  /** The installed apps, for the `app` class. */
  apps?: readonly ProseApp[];
  /** The stored verbatim prompt for this change, for the `yours` class. */
  storedPrompt?: string | null;
  /** Producer-supplied `chg`/`hedge` marks (the run summary's). Never inferred on device. */
  marks?: readonly Mark[];
  /** The persisted off-switch (`loadHighlighting`). `false` renders everything flat. */
  highlighting?: boolean;
  /** `true` when a status indicator already sits beside this prose — `state` is then suppressed,
   *  because the same status said twice reads as two statuses. */
  statusIndicatorAdjacent?: boolean;
  /** `true` on an ink background: colours resolve to their on-ink forms. */
  onInk?: boolean;
}

/** Every string the copy table offers. Rule 7: labels, buttons, settings and headings are what
 *  the product is OFFERING, not what it is TELLING you, so they are never marked — enforced here
 *  rather than trusted to each screen. */
const OFFERING_STRINGS: ReadonlySet<string> = new Set(
  Object.values(COPY).map((value) => value.trim()),
);

/** True when `text` is a copy-table string rather than agent prose. */
export function isOffering(text: string): boolean {
  return OFFERING_STRINGS.has(text.trim());
}

// ── sentences ─────────────────────────────────────────────────────────────────

/** Sentence start offsets. A terminator ends a sentence only when whitespace or the end of the
 *  text follows it, so `3.5` and `v4.2` stay inside one sentence. */
function sentenceStarts(text: string): number[] {
  const starts = [0];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
      let after = i + 1;
      while (after < text.length && /[\s”")']/.test(text[after])) after++;
      if (after > i + 1 && after < text.length) {
        starts.push(after);
        i = after;
        continue;
      }
    }
    i++;
  }
  return starts;
}

/** The index of the sentence a span belongs to, decided by where the span STARTS. */
function sentenceIndexOf(starts: readonly number[], offset: number): number {
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= offset) index = i;
  return index;
}

// ── caps ──────────────────────────────────────────────────────────────────────

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** One channel per span: two spans can never cover the same characters, so the lower-priority
 *  one is dropped whole. */
function resolveOverlaps(spans: readonly Span[]): Span[] {
  const kept: Span[] = [];
  for (const span of sortSpans(spans)) {
    if (!kept.some((other) => overlaps(span, other))) kept.push(span);
  }
  return kept;
}

/** Rule 4 then rule 1, per sentence, in that order — a coloured span the colour rule rejects
 *  frees room under the mark cap rather than consuming it. */
function applySentenceCaps(text: string, spans: readonly Span[], onInk: boolean): Span[] {
  const starts = sentenceStarts(text);
  const colourOf = new Map<number, string>();
  const systemCount = new Map<number, number>();
  const kept: Span[] = [];

  for (const span of sortSpans(spans)) {
    const sentence = sentenceIndexOf(starts, span.start);

    if (COLOURED_CLASSES.has(span.cls)) {
      const colour = resolveColor(text, span, onInk) ?? '';
      const taken = colourOf.get(sentence);
      if (taken !== undefined && taken !== colour) continue;
      colourOf.set(sentence, colour);
    }

    if (span.cls !== 'yours') {
      const used = systemCount.get(sentence) ?? 0;
      if (used >= MAX_SYSTEM_MARKS_PER_SENTENCE) continue;
      systemCount.set(sentence, used + 1);
    }

    kept.push(span);
  }

  return kept.sort((a, b) => a.start - b.start);
}

// ── colour ────────────────────────────────────────────────────────────────────

function resolveColor(text: string, span: Span, onInk: boolean): string | undefined {
  switch (span.cls) {
    case 'app':
      return span.color;
    case 'yours':
      return onInk ? SHELL_COLORS.yoursOnDark : SHELL_COLORS.yours;
    case 'state': {
      const table = onInk ? STATUS_COLORS_ON_INK : STATUS_COLORS;
      const word = text.slice(span.start, span.end).toLowerCase();
      if (word === 'broken') return table.broken;
      if (word === 'waiting') return table.waiting;
      return table.working;
    }
    case 'hedge':
      return SHELL_COLORS.faint;
    default:
      return undefined;
  }
}

// ── marks ─────────────────────────────────────────────────────────────────────

/** Producer marks are untrusted offsets: anything inverted, empty, or off the end of the text is
 *  dropped rather than clamped — a mark that does not resolve marks nothing. */
function validMarks(marks: readonly Mark[] | undefined, length: number): Span[] {
  if (marks === undefined) return [];
  return marks
    .filter(
      (mark) =>
        (mark.cls === 'chg' || mark.cls === 'hedge') &&
        Number.isInteger(mark.start) &&
        Number.isInteger(mark.end) &&
        mark.start >= 0 &&
        mark.end > mark.start &&
        mark.end <= length,
    )
    .map((mark) => ({ cls: mark.cls, start: mark.start, end: mark.end }));
}

// ── the renderer ──────────────────────────────────────────────────────────────

function toSegments(text: string, spans: readonly Span[], onInk: boolean): ProseSegment[] {
  const segments: ProseSegment[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at) segments.push({ text: text.slice(at, span.start), cls: null });
    const color = resolveColor(text, span, onInk);
    segments.push({ text: text.slice(span.start, span.end), cls: span.cls, ...(color ? { color } : {}) });
    at = span.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at), cls: null });
  return segments;
}

/**
 * Render one piece of agent prose into contiguous segments. Every discipline rule is applied
 * here; a caller cannot opt out of one, and a producer cannot exceed one.
 */
export function renderProse(text: string, options: RenderProseOptions = {}): ProseSegment[] {
  if (text.length === 0) return [];

  const highlighting = options.highlighting ?? true;
  if (!highlighting || isOffering(text)) return [{ text, cls: null }];

  const onInk = options.onInk ?? false;
  const lexed = lexProse(text, options.apps ?? [], options.storedPrompt);
  const candidates = [...lexed, ...validMarks(options.marks, text.length)].filter(
    (span) => !(options.statusIndicatorAdjacent === true && span.cls === 'state'),
  );

  return toSegments(text, applySentenceCaps(text, resolveOverlaps(candidates), onInk), onInk);
}

/** The flat form of a piece of prose — every mark removed, the words untouched. Rule 5's test
 *  obligation ("it must survive being switched off") is exactly this equalling the input. */
export function flattenProse(segments: readonly ProseSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}
