/**
 * whim-prose types — the Whim Syntax vocabulary (docs/design/system.md §2.7 "Whim Syntax,
 * simplified"; `app-launcher` "Shell prose renders through one Whim Syntax renderer with simplified
 * channels").
 *
 * Shell-side ONLY. This vocabulary is never exported from `vc-sdk`: the marks describe what the
 * PRODUCT is telling the user about a change, and its status colours do not carry that meaning
 * inside a mini-app's own UI.
 */

/** The six classes, each on one channel (§2.7): `app` its tint text colour, `chg` weight 600,
 *  `yours` italic in `text`, `measure` tabular figures, `state` `positive-text`/`danger-text`,
 *  `hedge` `text-2`. */
export type WhimClass = 'app' | 'chg' | 'yours' | 'measure' | 'state' | 'hedge';

/** The two model-tagged classes. The device NEVER infers these — they arrive as producer marks on
 *  the run's summary (`result.summary.marks`). */
export type MarkClass = 'chg' | 'hedge';

/** A producer-supplied mark: half-open `[start, end)` character offsets into the same `text` the
 *  renderer is given. Structurally identical to the wire contract's summary mark, deliberately
 *  redeclared here so the shell renderer never imports the generation contract. */
export interface Mark {
  cls: MarkClass;
  start: number;
  end: number;
}

/** One lexed or marked run of text, `[start, end)`. `color` is set only for `app` spans (that
 *  app's tint text colour, as the caller resolved it). */
export interface Span {
  cls: WhimClass;
  start: number;
  end: number;
  color?: string;
}

/** An installed app as the lexer sees it: its display name and its tint's text colour for the
 *  current scheme (`TINTS[tint][scheme]`, the tint the tile draws), so a tile and every prose
 *  mention of it always agree. */
export interface ProseApp {
  name: string;
  color: string;
}

/** A contiguous piece of rendered prose. `cls === null` means flat text. Concatenating every
 *  segment's `text` reproduces the input exactly: a dropped mark loses its CHANNEL, never its
 *  words. */
export interface ProseSegment {
  text: string;
  cls: WhimClass | null;
  color?: string;
}
