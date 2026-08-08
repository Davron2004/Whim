/**
 * server/src/generation/summarise.ts — the post-run summariser (spec "A post-run summariser
 * describes the completed run in one plain-words sentence").
 *
 * Two guarantees are structural rather than promised:
 *
 *  1. **It cannot change what is delivered.** `SummariserInput` carries no `WireAppRecord`, no
 *     bundle, no schema and no manifest object — only a handful of copied primitives. There is
 *     nothing here to mutate, so no summariser (model-backed, fake, or hostile) can alter the
 *     record the run assembled before it ran.
 *  2. **It cannot fail a run.** `summarise` resolves `{}` instead of rejecting on every failure
 *     path (bad JSON, unusable prose, transport error, timeout), and `machine.ts` additionally
 *     catches — so a run that produced a deliverable record still emits its `result`, with the
 *     summary simply absent.
 *
 * The model is asked for PROSE plus two optional PHRASES, never for character offsets: offsets are
 * resolved here, deterministically, against the text the model actually returned. That is what
 * makes the "marks resolve and never overlap" invariant a property of this file rather than a hope
 * about a small model's arithmetic.
 */
import type { Diagnostic, RunSummary, SummaryKind, SummaryMark, Usage } from '@whim/contract';
import type { ModelClient, ModelRoster } from './model';
import { buildSummaryMessages } from './prompts';
import { parseJsonBlock } from './json-block';

/** Everything the summariser is allowed to see. Deliberately record-free (see the header). */
export interface SummariserInput {
  /** The user's own request for this run. */
  prompt: string;
  /** True when the run edited an existing install rather than creating one. */
  isEdit: boolean;
  /** The delivered app's name — copied, not a reference into the record. */
  appName: string;
  /** The delivered manifest's declared capabilities — copied. */
  capabilities: string[];
  /** Candidates produced before delivery: 1 means "first try", >1 means repairs happened. */
  attempts: number;
  /** Diagnostics accumulated on the way to delivery — what the run *learned*. Copied. */
  diagnostics: Diagnostic[];
}

/** `summary` absent = "no summary for this run", a legitimate state. `usage` is the summariser's
 *  own token spend, folded into the run's total by the machine so it is credited like any other
 *  model call. */
export interface SummariseResult {
  summary?: RunSummary;
  usage?: Usage;
}

export interface Summariser {
  /** Never rejects — every failure resolves `{}`. */
  summarise(input: SummariserInput, signal?: AbortSignal): Promise<SummariseResult>;
}

const KINDS: readonly SummaryKind[] = ['Start', 'Added', 'Changed', 'Removed', 'Look', 'Fixed'];

/** How many `touched` areas survive. A summary is a glance, not an inventory. */
const MAX_TOUCHED = 4;

const DEFAULT_TIMEOUT_MS = 20_000;

// ─── Pure shaping (exported for the acceptance suite) ────────────────────────

/** Sentence spans of `text`, as `[start, end)` offsets. `!` never appears (stripped upstream). */
function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    const next = text[cursor + 1];
    const terminates = (ch === '.' || ch === '?') && (next === undefined || /\s/.test(next));
    if (!terminates) {
      cursor += 1;
      continue;
    }
    ranges.push({ start, end: cursor + 1 });
    cursor += 1;
    while (cursor < text.length && /\s/.test(text[cursor] ?? '')) cursor += 1;
    start = cursor;
  }
  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges;
}

/** One sentence, no exclamation marks. Voice rules the summariser can satisfy mechanically without
 *  rewriting the model's words: `!` becomes `.`, and everything after the first sentence is cut. */
function toOneSentence(raw: string): string {
  const flattened = raw.replace(/!/g, '.').replace(/\.{2,}/g, '.').trim();
  if (flattened.length === 0) return '';
  const first = sentenceRanges(flattened)[0];
  return first ? flattened.slice(first.start, first.end).trim() : flattened;
}

function asKind(value: unknown, fallback: SummaryKind): SummaryKind {
  if (typeof value !== 'string') return fallback;
  return KINDS.find((k) => k.toLowerCase() === value.trim().toLowerCase()) ?? fallback;
}

function asTouched(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length === MAX_TOUCHED) break;
  }
  return out;
}

/**
 * Resolves at most one `chg` and one `hedge` phrase to offsets into `text`. A phrase is placed at
 * its FIRST occurrence only (exact match preferred, case-insensitive as a fallback), skipped when
 * it does not occur at all or would overlap an already-placed mark. Placing each class at most
 * once over the whole text satisfies the per-sentence budget by construction.
 */
export function resolveMarks(text: string, phrases: Array<{ cls: SummaryMark['cls']; phrase: unknown }>): SummaryMark[] {
  const marks: SummaryMark[] = [];
  const lower = text.toLowerCase();
  for (const { cls, phrase } of phrases) {
    if (typeof phrase !== 'string') continue;
    const needle = phrase.trim();
    if (needle.length === 0) continue;
    if (marks.some((m) => m.cls === cls)) continue;
    let start = text.indexOf(needle);
    if (start < 0) start = lower.indexOf(needle.toLowerCase());
    if (start < 0) continue;
    const mark: SummaryMark = { cls, start, end: start + needle.length };
    if (marks.some((m) => mark.start < m.end && m.start < mark.end)) continue;
    marks.push(mark);
  }
  return marks.sort((a, b) => a.start - b.start);
}

/**
 * The model's raw JSON → a conforming `RunSummary`, or `undefined` when there is no usable prose.
 * Shape asked for: `{ text, kind, touched: string[], chg?: string, hedge?: string }`.
 */
export function shapeSummary(raw: unknown, fallbackKind: SummaryKind): RunSummary | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const v = raw as Record<string, unknown>;
  if (typeof v.text !== 'string') return undefined;
  const text = toOneSentence(v.text);
  if (text.length === 0) return undefined;
  return {
    text,
    kind: asKind(v.kind, fallbackKind),
    touched: asTouched(v.touched),
    marks: resolveMarks(text, [
      { cls: 'chg', phrase: v.chg },
      { cls: 'hedge', phrase: v.hedge },
    ]),
  };
}

/** `Start` for a first build, `Changed` for an edit — the honest default when the model named no
 *  kind or named one outside the closed set. */
export function fallbackKindFor(input: SummariserInput): SummaryKind {
  return input.isEdit ? 'Changed' : 'Start';
}

// ─── The model-backed summariser ─────────────────────────────────────────────

export interface ModelSummariserOptions {
  model: ModelClient;
  roster: ModelRoster;
  /** Wall-clock budget for the whole turn. On expiry the run is summarised as nothing at all. */
  timeoutMs?: number;
}

/** Resolves `undefined` after `ms`, with a timer that never keeps the process alive. */
function timeoutAfter(ms: number): { promise: Promise<undefined>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * The production `Summariser`: one turn on the roster's small/fast model (the same role `/v1/rewrite`
 * uses — the summariser writes one sentence of product prose, not code, and adding a fourth roster
 * role would mean a new required environment variable for a step that must never fail a run).
 */
export function createModelSummariser(options: ModelSummariserOptions): Summariser {
  const { model, roster } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async summarise(input: SummariserInput, signal?: AbortSignal): Promise<SummariseResult> {
      const controller = new AbortController();
      const forwardAbort = (): void => controller.abort();
      signal?.addEventListener('abort', forwardAbort, { once: true });
      const timeout = timeoutAfter(timeoutMs);

      try {
        const turn = (async (): Promise<SummariseResult> => {
          const stream = model.stream(
            { model: roster.rewrite, messages: buildSummaryMessages(input) },
            controller.signal,
          );
          // Attach the rejection handler the moment the stream exists: a provider rejects `usage`
          // on the same paths where the delta iterator throws, and a rejection observed later than
          // that is an unhandled one (the idiom `machine.ts#settle` exists for).
          const settledUsage = stream.usage.then(
            (u) => u,
            () => undefined,
          );
          let text = '';
          for await (const delta of stream.deltas) text += delta;
          const usage = await settledUsage;
          const summary = shapeSummary(parseJsonBlock(text), fallbackKindFor(input));
          return summary ? { summary, usage } : { usage };
        })();

        const settled = await Promise.race([turn.catch(() => undefined), timeout.promise]);
        if (settled === undefined) controller.abort(); // timed out (or threw) — stop the turn
        return settled ?? {};
      // eslint-disable-next-line no-restricted-syntax -- intentional: mirrors the race/timeout no-throw contract this turn documents above
      } catch {
        return {};
      } finally {
        timeout.cancel();
        signal?.removeEventListener('abort', forwardAbort);
      }
    },
  };
}
