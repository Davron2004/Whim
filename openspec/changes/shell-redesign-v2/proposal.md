## Why

The shell's visual language is placeholder work. `src/sdk/theme.ts` ships six AI-generated theme
presets, ten accent swatches and the framework-default indigo `#4f46e5`; every launcher screen
falls through to Android's Roboto because no font infrastructure exists; app tiles are a djb2 hash
of the display name; and the prompt flow is a rewrite-preview screen bolted in front of a spinner.

`docs/design/README.md` (design handoff v2, imported at `b164329`) replaces all of it with an
argued system: a fixed, almost-colourless shell so saturated colour always carries meaning; three
faces (Instrument Sans / IBM Plex Mono / Newsreader Italic) where Space Grotesk and Roboto were;
and **Whim Syntax** — the load-bearing idea. Whim's UI is mostly machine-written prose, so the type
system *is* the design system: prose is marked by the role a span plays in the product (`app`,
`chg`, `yours`, `measure`, `state`, `hedge`), not by grammar, over four channels (colour, weight,
typeface, de-emphasis).

Two of the handoff's eight engineering items are not cosmetic at all. The **post-run summariser**
is a product feature — screen `4a` is not implementable without it, because a history row is meant
to answer "what did I ask for, and what happened", not replay the prompt string. And **one declared
tile colour per app** is the only thing the shell asks back from a generated app; today the shell
guesses.

The three OPEN questions the handoff refused to answer have been answered by the user
(`research.md` §1): tile colour is **declared** by the app with the
deterministic function demoted to a fallback; legacy preset apps **re-skin now**, zero migration,
because the SDK is tokens-not-values (decision #13); screen `4b` **does not exist**.

## What Changes

Seven waves, matching the handoff's engineering list minus the orb wheel gesture:

- **v2 token set** in `src/sdk/theme.ts` — the fixed shell palette (`paper`/`surface`/`border`/
  `ink`/`text`/`muted`/`faint`/`accent`/`yours`/`yours-on-dark`), the three reserved status hues,
  the three faces + eight-step type scale, the five radii, the five-step spacing scale and the
  motion table. `#4f46e5` and Space Grotesk are retired repo-wide.
- **The six presets and ten accents are deleted** with no frozen-palette migration and no per-app
  palette pinning. The Settings screen loses the preset/accent/shape picker and keeps a
  **highlighting off-switch**.
- **`appColor(name)`** — one deterministic name→hue function in the SDK theme module, imported by
  the grid, the declared-colour fallback and the prose renderer, so a mention of an app in running
  text carries that app's own tile hue.
- **Whim Syntax as one shared renderer + one deterministic client lexer**, shell-side
  (`src/host/ui/whim-prose/`). Four classes are lexed on device (`app`, `measure`, `yours`,
  `state`); `chg` and `hedge` arrive as model-side marks. The discipline rules (four marks per
  sentence, one colour per sentence, one channel per span, `yours` exempt) are **enforced in the
  renderer**, not merely prompted for.
- **Fonts** ship as static TTFs under `android/app/src/main/assets/fonts/`, resolved by filename.
- **Clarify** is a new pre-stream request/response endpoint (`POST /v1/clarify`), gated by
  `x-whim-device` like every `/v1` route. It returns 0–3 questions; answers are threaded into the
  existing generation request. The ratified `GenerationEvent.stage` enum is not touched.
- **The post-run summariser** rides on the terminal `result` event as
  `{ text, kind, touched, marks }`, at most one `chg` and one `hedge` per sentence at the source.
  Exactly one terminal event per completed stream — unchanged.
- **The prompt envelope goes to `{v: 2, text, summary?}`**, version-bumped and backward-readable:
  a `v1` envelope (and a raw legacy string) still renders, falling back to the prompt text.
- **A declared `tileColor`** on `defineApp`, extracted at build time into the same single manifest
  extraction as capabilities — no second source of truth — and read by the host from its own
  record, never from the bundle's runtime self-description.
- **Screen `2a`** — the launcher flow becomes compose → clarify → plan → build → done, replacing
  the prompt → rewrite-preview → generating chain.
- **Screen `4a`** — history rows are stored summaries rendered through Whim Syntax, with filter
  pills, an expanded row (result, what it touched, at most two next actions) and a confirm sheet
  where the **safe** option is the large button and the consequential action is demoted to plain
  text.
- **Screen `2b`** — the ghost-letterform tile: 88×88, radius 22, solid app colour, monogram small
  at bottom-left and the same monogram blown up bleeding off the top-right at 16% white.
- **The orb ships as the tapped menu**, instrumented with per-action tap counts through the
  launcher's existing persistence path.

## Capabilities

### Modified Capabilities

- `sdk-design-system` — the fixed v2 token set, the three faces, the declared tile colour, the
  shared `appColor` function, skeleton geometry from exported component constants.
- `app-launcher` — the theme-preference surface is removed; tiles, the Whim Syntax renderer/lexer,
  the highlighting off-switch and the instrumented orb menu are added.
- `prompt-flow` — the two-stage rewrite-preview flow is replaced by the five-step `2a` machine, and
  the prompt envelope is version-bumped.
- `version-history` — rows are fed by stored summaries, tap expands rather than restores, restore
  and fork go through the safe-large confirm sheet, filter pills ship.
- `generation-contract` — clarify shapes, the optional plan rows on `RewriteResponse`, the summary
  on the terminal `result` event, `tileColor` inside the manifest record.
- `generation-server` — the `/v1/clarify` route under the existing device gate; the rewrite
  endpoint may return plan rows.
- `generation-pipeline` — the post-run summariser stage and the single-extraction rule extended to
  cover `tileColor`.
- `mini-app-versioning` — a snapshot's structured prompt is a versioned envelope whose readers
  accept every earlier version.

### New Capabilities

None. Whim Syntax lands inside `app-launcher` rather than as its own capability: the marks
vocabulary is shell semantics with no wire surface and no second consumer.

## Out of scope

- **Screen `4b`.** Its existence was an OPEN question; the answer is no. There is no dedicated
  "last change, undoable in place" screen — `4a` is the whole history surface.
- **The orb flick gesture.** No press-and-hold arming, no `360/n` wedges, no angle-of-travel
  hit-testing, no per-user action assignment, no variable-arity wheel component. The tapped menu
  ships and is instrumented; the wheel is a later change decided by what the instrumentation says.
  The menu's teaching affordances that only exist to sell the wheel (the per-row direction hints,
  the "Hold the button next time" caption) are therefore also out.
- **Every FEEL IT experiment beyond its cheap version.** One-line summaries only — no multi-line
  commit messages. No highlight decay with age. No prophetic/ghost-tile empty state. No
  whim-word-frequency tuning. The off-switch ships precisely so those experiments can be run
  honestly later; running them is not this change.
- **The repair ladder screens (`3b`).** The six-state failure ladder is a standalone demo screen in
  the prototype, not reachable from `2a`/`3a`. Today's `FailureScreen` behaviour is unchanged.
- **The quiet build treatment (`2c`) as a replacement for the terminal log.** The build screen
  ships one plain-words sentence at a time per `2c`; the raw terminal log is not built at all in
  this change (no "show details" disclosure).
- **Colour bundles recommended to the user** for their own app's look — the handoff names this as a
  separate, undesigned idea.
- **Re-skinning already-installed mini-apps by any mechanism other than the token seam.** No
  frozen palettes, no per-app pinning, no migration pass. Apps re-skin because they only ever spoke
  tokens.

## Impact

- **SDK**: `src/sdk/theme.ts` (v2 tokens, presets/accents deleted, `appColor`), `src/sdk/tokens.ts`
  (`FONT` → the three faces), `src/sdk/index.tsx` (`AppSpec.tileColor`), `src/sdk/charts.tsx`
  (absorbs the re-palette through the token seam).
- **Shell**: `src/host/ui/whim-prose/` (new), `src/host/launcher/` — `LauncherRoot.tsx`,
  `HomeScreen.tsx`, `HistoryScreen.tsx`, `SettingsScreen.tsx`, `FloatingExit.tsx`, `tiles.ts`,
  `theme.ts`, `theme-context.tsx`, `copy.ts`, `prompt-envelope.ts`, `history-logic.ts`, plus the
  new `2a` screens; `src/host/bridge/contract.ts` (`AppManifest.tileColor`).
- **Server/contract**: `contract/src/index.ts`, `server/src/generation/` (clarify handler,
  summariser, record assembly), `server/src/main.ts` route table.
- **Android**: `android/app/src/main/assets/fonts/` (seven static TTFs; canonical copies under
  `assets/fonts/`). No `react-native.config.js`, no `react-native-asset`, `package.json` untouched.
- **Tests**: new suites join the **existing** runners — `src/host/launcher/test/acceptance.ts`
  imports (launcher), `*.acceptance.ts(x)` discovery (sdk), the server acceptance entry. No npm
  script is added; `package.json` is Class 2.
- **Docs**: `docs/capabilities.md` scope lines, `docs/decisions.md` (the answered OPEN questions,
  the clarify-is-not-a-stage call, the envelope bump).
