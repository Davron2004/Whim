# handoff: chain-B — Whim Syntax renderer, lexer, and the v2 copy table

Interface only. Source of record: `src/host/ui/whim-prose/` (shell-side; NEVER `vc-sdk`) and
`src/host/launcher/copy.ts`.

## Import rules

Deliberately **no barrel** (it would drag `WhimProse.tsx` → `react-native` into every Node suite
that wanted a type). Import the module: `ui/whim-prose/WhimProse` (RN screens only),
`ui/whim-prose/{lex,render,styles,types}` (anywhere, suites included).

## Types (verbatim)

```ts
export type WhimClass = 'app' | 'chg' | 'yours' | 'measure' | 'state' | 'hedge';
export type MarkClass = 'chg' | 'hedge';
export interface Mark { cls: MarkClass; start: number; end: number; }        // [start,end) into text
export interface Span { cls: WhimClass; start: number; end: number; color?: string; }
export interface ProseApp { name: string; color?: string; }                  // color = DECLARED hue
export interface ProseSegment { text: string; cls: WhimClass | null; color?: string; }
```

`Mark` is structurally identical to the wire summary's mark (chain-C `result.summary.marks`),
redeclared so the shell renderer never imports the contract. Pass `summary.marks` straight in.

## API

```ts
// lex.ts — pure, deterministic, no model involvement
export function lexProse(text: string, apps?: readonly ProseApp[], storedPrompt?: string | null): Span[];
export const STATE_VOCABULARY: readonly ['working', 'broken', 'waiting'];
export const CLASS_PRIORITY: Readonly<Record<WhimClass, number>>;   // yours 0 … hedge 5

// render.ts — the caps live here
export interface RenderProseOptions {
  apps?: readonly ProseApp[];
  storedPrompt?: string | null;
  marks?: readonly Mark[];              // producer chg/hedge only; never inferred on device
  highlighting?: boolean;               // default true
  statusIndicatorAdjacent?: boolean;    // true suppresses every `state` span
  onInk?: boolean;                      // ink background: on-ink colour forms
}
export function renderProse(text: string, options?: RenderProseOptions): ProseSegment[];
export function flattenProse(segments: readonly ProseSegment[]): string;
export function isOffering(text: string): boolean;
export const MAX_SYSTEM_MARKS_PER_SENTENCE = 4;

// styles.ts — class -> ONE channel, RN-TextStyle-shaped, no react-native import
export interface ProseTextStyle { color?: string; fontFamily?: string; fontWeight?: '500'; fontStyle?: 'italic'; }
export function proseStyle(segment: ProseSegment): ProseTextStyle | undefined;

// WhimProse.tsx
export interface WhimProseProps extends Omit<RenderProseOptions, 'highlighting'> {
  text: string; highlighting?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number;
}
export default function WhimProse(props: Readonly<WhimProseProps>): JSX.Element;
export function HighlightingProvider(p: Readonly<{ enabled: boolean; children: React.ReactNode }>): JSX.Element;
export function useHighlighting(): boolean;
```

## Invariants the renderer guarantees (you cannot opt out, and need not re-implement)

- **Text is never lost.** `flattenProse(renderProse(t, …)) === t`, always. A capped mark loses its
  channel, never its words — nothing is truncated mid-span.
- **≤4 system marks per sentence** (`yours` exempt). **≤1 colour per sentence** — one hue, so two
  mentions of the *same* app both keep it, two different apps do not. Colour is spent by `app`,
  `state` and `yours`; `hedge`'s `faint` grey is de-emphasis, not a hue.
- **One channel per span**, `yours` alone gets two (Newsreader italic + `yours` brown).
- **Overlaps drop the lower-priority span whole**: `yours` > `app` > `chg` > `state` > `measure` >
  `hedge`. Ties break by position, then length.
- **Rule 7 is mechanical**: any string that is exactly a `COPY` value renders flat. Labels,
  buttons, settings rows and headings are therefore unmarkable — do not pass them through the
  renderer expecting marks, and do not work around it.
- **`chg`/`hedge` are producer-only.** Invalid marks (inverted, empty, off the end) are dropped.
- Rule 6 is YOURS to honour: **never render a field being typed through this** — a prompt is
  highlighted only after submission.

## The off-switch — one line chain-D must write

`renderProse` defaults to highlighting ON. `WhimProse` reads the persisted flag from context, so
**chain-D must wrap the launcher tree once**:

```tsx
<HighlightingProvider enabled={highlighting}>{/* LauncherShell's existing tree */}</HighlightingProvider>
```

`highlighting` is the state `LauncherRoot` already holds from `loadHighlighting(kv)`. Without that
wrapper the switch is inert everywhere (default true). No second flag, no per-screen prop drilling.

## Colour of an `app` span

Pass `apps` as `{ name, color? }` where `color` is the app's **declared** tile colour from the
host-held record (chain-F's resolution). Omit it and the lexer falls back to the SDK's
`appColor(name)` — the one name→hue mapping, so a tile and every prose mention agree.

## COPY — read these keys, add none

`src/host/launcher/copy.ts` is seeded for every v2 screen. Groups D–G **add no strings**; a
missing key is a blocker to raise, not a string to invent.

- home/2a: `homeTitle`, `homeSubtitle`, `homeComposerPlaceholder`
- flow: `flowBusy` (`One moment`), `flowContinue`, `composeHeadline`, `composeHelper`,
  `composeChipsEyebrow`, `composeChipTimer|Tracker|Dice`, `clarifyHeadlineOne|Two|Three` (+
  `clarifyHeadline(n)`), `clarifyHelper`, `planHeadline`, `planSubhead`, `planFooter`, `planBuild`,
  `buildTitle`, `buildSubtitle`, `buildStepReading|Writing|Checking|Installing`,
  `buildLeaveRunning`, `doneBody`, `doneOpen`, `doneBackToApps`, `readyTitle(name)`
- history/4a: `historyTitleSuffix`, `historySubtitle(count, when)`, `historyOriginYouSaid`,
  `historyOriginUnprompted`, `historyCurrentMarker`, `historyTouchedEyebrow`,
  `historyChangeFromHere`, `historyGoBackToThis`, `historyStartCopyHere`, `historyFilterAll(n)`,
  `historyFilterWhatItDoes|Look|Fixes`, `historyKindAdded|Changed|Removed|Look|Fixed|Start`,
  `historyReassurance`, `restoreSheetTitle(v)`, `restoreSheetBody(v, losing?)`,
  `historyRestoreConfirm`, `restoredToast(v)`, `copySheetTitle(v)`, `copySheetBody(name)`,
  `historyCopyConfirm`, `historyCopyToast`, `cancel`
- orb/3a: `orbActionChangeIt|Home|Versions|Copy`, `orbClose`, `orbVersionsTitle`, `orbChangeTitle`,
  `orbChangeFooter`, `orbHomeToast`

The block marked **"retiring with the surfaces they belong to"** (`prompt*`, `rewritePreview*`,
`generating*`, `historyPin*`, `historyUndo`, `historyRestoredToast`, `historyCurrentLabel`,
`historyForkAction`, `historyMoreLabel`) exists only to keep the tree typechecking until the chain
that deletes each screen deletes its keys with it. Deleting a key ahead of its screen is a break.
