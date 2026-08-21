/**
 * whim-prose types — the Whim Syntax vocabulary (design D7; docs/design/README.md "Whim Syntax —
 * prose highlighting").
 *
 * Shell-side ONLY. This vocabulary is never exported from `vc-sdk`: the marks describe what the
 * PRODUCT is telling the user about a change, and the three status hues do not carry that meaning
 * inside a mini-app's own UI.
 */

/** The six classes. Each renders on exactly ONE channel — colour, weight, face, or de-emphasis —
 *  except `yours`, the single class allowed two (Newsreader italic + the `yours` brown). */
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
 *  app's own hue, resolved through the single `appColor`/declared-colour path). */
export interface Span {
  cls: WhimClass;
  start: number;
  end: number;
  color?: string;
}

/** An installed app as the lexer sees it: its display name and, when the app declared one, its
 *  tile colour. With no declared colour the lexer falls back to the SDK's `appColor(name)` — the
 *  one name -> hue mapping in the repo, so a tile and every prose mention of it always agree. */
export interface ProseApp {
  name: string;
  color?: string;
}

/** A contiguous piece of rendered prose. `cls === null` means flat text. Concatenating every
 *  segment's `text` reproduces the input exactly: a dropped mark loses its CHANNEL, never its
 *  words. */
export interface ProseSegment {
  text: string;
  cls: WhimClass | null;
  color?: string;
}
