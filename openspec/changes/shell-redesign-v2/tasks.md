# Tasks: shell-redesign-v2

Groups A–G map one-to-one onto the chains in `chains.md`. Every user-visible string comes from
`docs/design/README.md` or `research.md` §2 verbatim — no copy is invented here or by
an implementer. Every new test joins an **existing** runner (design D13): `package.json` is Class 2
and no agent may add an npm script.

## A. v2 tokens, preset cut, app colour

> Group A is a **specification of record**. It is being implemented in parallel with the authoring
> of this change, so each item states the end state to hold, not a sequence assuming untouched code.
> Verify each item against the tree as it stands rather than re-applying it blindly.

- [ ] A1 `src/sdk/theme.ts` carries the fixed v2 shell palette, status hues, radii, spacing and
  motion values exactly as listed in `specs/sdk-design-system/spec.md` §"The shell token set is
  fixed, v2, and not themeable". `#4f46e5` appears nowhere in `src/`.
- [ ] A2 `PRESETS`, `ACCENTS`, and the shape variants are deleted; `ThemePref` no longer carries
  `preset`/`accent`/`shape`; `resolveTheme` returns the one fixed theme; `DEFAULT_THEME` is that
  theme. `sanitizeTheme` is **kept** unchanged — it is the sandbox trust boundary, not a preset
  mechanism (design D5).
- [ ] A3 `src/sdk/tokens.ts` resolves the three faces (Instrument Sans / IBM Plex Mono / Newsreader
  italic) and the type scale in `specs/sdk-design-system/spec.md` §"Three faces carry the whole type
  system", replacing the single generic `FONT` stack. `Space Grotesk` appears nowhere in `src/`.
- [ ] A4 Export `appColor(name: string): string` from the SDK theme module — pure, deterministic,
  drawing from a fixed saturated palette that excludes the three status hues, `accent` and `yours`
  (design D6). It is the **only** name→hue function in the repo.
- [ ] A5 The seven static TTFs are present under `android/app/src/main/assets/fonts/` with canonical
  copies under `assets/fonts/`, named so Android's by-filename `fontFamily` resolution finds them:
  `InstrumentSans-{Regular,Medium,SemiBold,Bold}`, `IBMPlexMono-{Regular,Medium}`,
  `Newsreader-Italic`. No `react-native.config.js`, no new dependency, `package.json` untouched.
- [ ] A6 `src/host/launcher/theme.ts` + `theme-context.tsx` expose the fixed theme and drop the
  preference plumbing; `shellPalette` maps the v2 roles.
- [ ] A7 `SettingsScreen.tsx` no longer renders a preset, accent, or shape picker (delta:
  `app-launcher` REMOVED §"The launcher persists a user theme preference…"), keeps the server-address
  field, and gains the persisted highlighting off-switch (delta: `app-launcher` §"Highlighting can be
  switched off"), stored through the launcher's existing key-value path.
- [ ] A8 `src/host/launcher/test/theme.suite.ts` is rewritten: the preset/accent iteration assertions
  are replaced by assertions that the fixed theme carries the v2 values, that `appColor` is
  deterministic and never returns a reserved hue, and that `#4f46e5`/`Space Grotesk` are absent from
  `src/`. Assert the off-switch's persistence round-trip and its default-on fallback for an absent or
  corrupt stored value. The suite keeps its existing registration in `test/acceptance.ts`.

## B. Whim Syntax + the v2 copy table

- [ ] B1 Create `src/host/ui/whim-prose/` (shell-side, **not** exported from `vc-sdk` — design D7)
  with a pure lexer: `(text, installedApps, storedPrompt) → spans` covering `app` (installed-app
  match), `measure` (number/duration/version pattern), `yours` (exact match against the stored
  verbatim prompt), `state` (the fixed three-word vocabulary). No model involvement; no inference of
  `chg`/`hedge`. Delta: `app-launcher` §"Four Whim Syntax classes are lexed deterministically…".
- [ ] B2 Add the renderer: merges lexer spans with producer-supplied `chg`/`hedge` marks and renders
  through the v2 tokens — `app` in that app's hue via `appColor`/the declared colour, `chg` at weight
  500 with no colour, `yours` in Newsreader italic + `yours`, `measure` in the mono face, `state` in
  the status hues, `hedge` in `faint`.
- [ ] B3 Enforce the discipline caps **in the renderer**: ≤4 system marks per sentence, ≤1 coloured
  span per sentence, one channel per span, `yours` exempt from the cap and the only two-channel span,
  `state` suppressed when a status indicator is already adjacent. Over-cap marks drop to flat text —
  never truncated mid-span. Delta: `app-launcher` §"Shell prose renders through one shared Whim
  Syntax renderer".
- [ ] B4 Wire the off-switch: with highlighting off the renderer emits no class-bearing span on any
  screen. Read the flag from the setting A7 persists; do not add a second flag.
- [ ] B5 Seed `src/host/launcher/copy.ts` with every new v2 string this change needs, taken verbatim
  from `docs/design/README.md` / `research.md` §2 — the `2a` step copy, the build step
  names, the done-screen copy, the `4a` header/origin/action/filter copy, the confirm-sheet and toast
  copy — and delete the strings the removed theme picker owned. Groups D–G read from this table and
  add no strings of their own. The product-verbs guard must stay green.
- [ ] B6 Add `whim-prose.suite.ts` under `src/host/launcher/test/` (registered in
  `test/acceptance.ts`): lexer determinism, `yours` never matching a paraphrase, `state` never
  matching a synonym, the four-mark cap, the one-colour-per-sentence rule, `yours` exemption, the
  off-switch producing zero spans, and — per the design's rule 5 — that every string in `copy.ts`
  rendered flat is still unambiguous.

## C. Contract + server: clarify, summariser, tileColor, envelope

- [ ] C1 `contract/src/index.ts`: add `ClarifyRequest`/`ClarifyResponse` (≤3 questions, each with
  non-empty options; an empty list is valid). Delta: `generation-contract` §"Clarify request and
  response shapes".
- [ ] C2 `contract/src/index.ts`: add optional `clarifications` to `GenerateRequest` and
  `RewriteRequest`, and optional `plan: {label,text}[]` to `RewriteResponse` (design D10). Delta:
  `generation-contract` §"Generation request and rewrite shapes".
- [ ] C3 `contract/src/index.ts`: add optional `summary { text, kind, touched, marks }` to the
  `result` terminal event, with `marks` as `{cls:'chg'|'hedge', start, end}` offsets. Do **not**
  widen the `stage` enum and do **not** add an event type. Delta: `generation-contract` §"SSE
  generation event stream schema", §"Summary marks are bounded and resolvable…".
- [ ] C4 `src/sdk/index.tsx`: add optional literal `tileColor` to `AppSpec` (statically extractable,
  never introspected). Delta: `sdk-design-system` §"An app declares its one tile colour".
- [ ] C5 Server check/machine stages: extract `tileColor` into `CheckedManifest` in the **same single
  extraction** that already yields capabilities, dropping a malformed value or one colliding with a
  reserved status hue. `assembleRecord` passes it through inside `manifest`; no second top-level
  field. Delta: `generation-pipeline` §"The delivered app record is harness-validated".
- [ ] C6 Add `POST /v1/clarify` to the server route table, behind the existing device-identity
  middleware, with a deterministic stub behind the stub selector and metering when model-backed.
  Delta: `generation-server` §"Clarify endpoint".
- [ ] C7 Apply the device gate by **path prefix** over `/v1` rather than route by route, so a route
  added later is gated by construction. Delta: `generation-server` §"Device-identity middleware".
- [ ] C8 Thread `clarifications` into the rewrite call and return `plan` rows when the model produces
  them. Delta: `generation-server` §"Rewrite endpoint over the real rewrite model".
- [ ] C9 Add the post-run summariser step to the pipeline: one plain-words sentence + `kind` +
  `touched` + `marks`, attached to the `result` event only, at most one `chg` and one `hedge` per
  sentence, honouring the voice rules (sentence case, no exclamation marks, outcome not mechanism,
  never apologise twice, zero whim-words in a staying-broken failure). A summariser error or timeout
  must **not** fail the run. Delta: `generation-pipeline` §"A post-run summariser…", §"Exactly one
  terminal event per completed run".
- [ ] C10 Assert in the server suite that the SSE route frames the summary through unmodified —
  neither synthesized nor stripped. Delta: `generation-server` §"SSE generation endpoint…".
- [ ] C11 Extend the server acceptance suite (existing entry point, no new npm script) with: clarify
  round-trip incl. the empty-questions case and the >3 rejection; the whole-route-table device gate;
  clarifications reaching the rewrite model; `tileColor` extraction incl. the malformed/reserved
  drops; summariser output shape and mark budget; and a summariser-failure case that still yields
  `result`.

## D. Launcher 2a flow

- [ ] D1 Restructure the `Screen` union and the render chain in `LauncherRoot.tsx` to the five-step
  machine `compose → clarify → plan → build → done`, replacing the `prompt` /`rewrite-preview` /
  `generating` screens. Forward moves are gated by the primary action; back moves are immediate.
  Delta: `prompt-flow` §"The prompt flow is a five-step machine…".
- [ ] D2 Build the compose step: headline `What should it do?`, the prompt field (never live-lexed),
  the helper line, the `Or start from` chips (fill only, never advance), and the bottom primary
  action. Delta: same requirement.
- [ ] D3 Call `POST /v1/clarify` between compose and plan; render ≤3 questions as single-select
  pills; echo the user's submitted words as the user's own words; keep the step skippable with zero
  answers; skip the step entirely when zero questions come back. Delta: `prompt-flow` §"Clarifying
  questions are a pre-stream exchange…".
- [ ] D4 Build the plan step: `Here's the plan`, the labelled rows (or the single-row fallback when
  the response carries no rows), the footer, and the `Build it` action. Tapping a row re-opens
  compose prefilled with that row's text — nothing more. Delta: `prompt-flow` §"The plan step is the
  approval gate before generation".
- [ ] D5 Build the build step: the four named steps derived from `stage` events
  (`Reading your plan`, `Writing the app`, `Checking it runs safely`,
  `Putting it on your home screen`), one plain-words current-action sentence at a time, `Leave it
  running` (returns to the shell without cancelling), no raw log/terminal panel, and **no** fade or
  per-character animation on arriving text. Delta: `prompt-flow` §"Generation progress is shown
  without exposing internals".
- [ ] D6 Build the done step: the app's own tile, `<App name> is ready`, the body line, and the two
  **distinct** destinations — `Open it` launches the delivered app, `Back to your apps` returns to
  the grid. Delta: `prompt-flow` §"The done step offers two distinct destinations".
- [ ] D7 Every busy primary action reads `One moment`; `Continue` on compose/clarify and `Build it`
  on plan; no bare-spinner-only control anywhere in the flow.
- [ ] D8 Bump the prompt envelope to `{v:2, text, summary?}` in `prompt-envelope.ts` and at the
  launcher's write site; keep `text` verbatim; keep every reader tolerant of `v1` and of a raw
  string. Delta: `prompt-flow` §"Every delivered generation is tracked…", `mini-app-versioning`
  §"Every generation is an immutable snapshot tagged with its prompt".
- [ ] D9 Rebuild `HomeScreen.tsx` to the `2a` home: `Whim` title, `Your apps` eyebrow, the 3-column
  grid of `AppTile` (group F's component, per its contract), and the `Describe an app…` composer
  entry row that opens the compose step. Delta: `app-launcher` §"The create affordance and per-app
  re-prompt action open the prompt flow".
- [ ] D10 Add grid and plan-row skeletons whose geometry comes from the components' exported size
  constants — exact tile geometry and count for the grid, **varying** widths for plan rows, `breathe`
  as the only motion, and no skeleton for an empty or may-never-fill state. Delta:
  `sdk-design-system` §"Loading skeletons derive their geometry from exported component constants".
- [ ] D11 Update `prompt-flow-screens.suite.ts` and `prompt-flow-wiring.suite.ts` to the new machine:
  step ordering, the zero-questions skip, back-is-immediate, busy labels, plan-row tap prefilling
  compose, `Open it` vs `Back to your apps` reaching different destinations, and the `v2` envelope
  round-trip including a `v1` read.

## E. Launcher 4a history

- [ ] E1 Rebuild `HistoryScreen.tsx` to the `4a` timeline: header naming the app in its own hue over
  the version-count subtitle; per row a kind badge, timestamp, version id, origin line
  (`You said` / `Whim, on its own`) and a headline rendered through the shared renderer. Preserve the
  screen's existing exported props signature; if it must change, that change belongs to group D.
  Delta: `version-history` §"History reads as the user's own prompts".
- [ ] E2 Feed rows from the stored summary, falling back to the version's prompt text when there is
  none (older envelope, raw string, or a run that produced no summary). Delta: same requirement.
- [ ] E3 Mark the active version `↑ you're on this one`, derived live from the store, never persisted
  on the app record.
- [ ] E4 Make a tap **expand** a row rather than restore, one row open at a time. Delta:
  `version-history` §"Tapping a row expands it; restoring is confirmed, never instant".
- [ ] E5 Build the expanded body: the result sentence, the `What it touched` chips (area names, never
  diffs), the data-shape annotation rendered as a `hedge`, and at most two actions — exactly
  `Change it from here` for the current version, exactly `Go back to this` + `Start a copy here` for
  a past one. Deltas: `version-history` §"An expanded row answers…", §"Data-shape annotations and
  restore reassurance".
- [ ] E6 Build the filter pills: the all-versions pill with a live count plus one pill per summariser
  kind; all-versions selected by default; a version with no kind stays reachable under it. Delta:
  `version-history` §"Filter pills group the list by what changed".
- [ ] E7 Build the confirm sheet for restore and for copy: safe option as the large button,
  consequential action demoted to plain text, sheet rising from the edge it returns to, body naming
  what comes off / what is kept / that the user can come forward again from this list, and the
  restore reassurance when the target predates a field now holding data. Toasts on confirmation.
  Delta: `version-history` §"A confirm sheet makes the safe option the large button", §"Any version
  can become its own app".
- [ ] E8 Remove the pin surface from the history screen (labels on rows, the pin action). Do **not**
  remove the store verbs or the `StoreAccess` wrappers; stored pins stay stored. Delta:
  `version-history` REMOVED §"Named pins".
- [ ] E9 Update `history-logic.ts` for the new row model (summary-or-prompt headline resolution, kind
  grouping for the filters) and extend `history-logic.suite.ts` accordingly: fallback to prompt text,
  unclassified rows under the all-versions pill, live count, current-version marking after a restore,
  and that no row exposes more than two actions.
- [ ] E10 Screen `4b` is not built. Do not add a "last change, undoable in place" surface.

## F. Tile colour plumbing + the 2b tile

- [ ] F1 Extend the host-held `AppManifest` (`src/host/bridge/contract.ts`) with the optional
  declared tile colour, keeping it host-held and harness-trusted — the gate still reads only this
  type, never the bundle's self-description.
- [ ] F2 Add the resolution helper: declared colour when present and valid, `appColor(name)`
  otherwise (malformed, absent, or colliding with a reserved hue). One path, used by the grid, the
  history header and the prose renderer. Delta: `app-launcher` §"A tile's colour is the app's
  declared colour, with a deterministic fallback".
- [ ] F3 Reduce `src/host/launcher/tiles.ts` to `monogram` plus a delegation to `appColor` — delete
  `TILE_COLORS` so no second name→hue mapping survives (design D6).
- [ ] F4 Build the `2b` ghost-letterform `AppTile` component: square, tile radius, solid app colour,
  foreground monogram bottom-left, the same monogram oversized and bleeding off the top-right at 16%
  white, 1px inset white border at 30%, name below the tile. Export its size constants for group D's
  skeleton. Delta: `app-launcher` §"App tiles use the ghost-letterform treatment".
- [ ] F5 Add the record-mapping module that lifts the wire manifest's colour onto the host record, so
  the mapping is testable without mounting the shell. Group D consumes it; it does not itself edit
  `LauncherRoot.tsx`.
- [ ] F6 Add a suite (registered in `test/acceptance.ts`) covering: declared colour wins; malformed
  and reserved-hue declarations fall back; an app with no declaration resolves `appColor(name)`; a
  bundle's self-reported colour never overrides the record; and grid, header and prose resolve one
  app to one colour.

## G. The orb tapped menu, instrumented

- [ ] G1 Replace `FloatingExit.tsx` with the orb: ink circle, tap opens the menu, tapping the orb
  again closes it, tapping the scrim dismisses with no side effect. Delta: `app-launcher` §"The orb
  is a tapped menu whose actions are instrumented".
- [ ] G2 Populate the menu with cheap, undoable actions only — no delete, rename, or restore. The
  versions action opens the versions sheet (screen `4b` does not exist).
- [ ] G3 Persist a per-action tap count through the launcher's existing key-value path. No counter or
  count appears on any user-facing surface.
- [ ] G4 Ship **no** wheel affordance: no press-and-hold arming, no directional flick, no wedge
  geometry, and no copy advertising one — no per-row direction hints and no "hold to flick" caption.
- [ ] G5 Add a suite (registered in `test/acceptance.ts`): open/close/dismiss transitions fire no
  action, the action set contains nothing destructive, tap counts accumulate across sessions and stay
  off-screen, and the menu renders no direction hint or hold caption.

## H. Docs

- [ ] H1 Append decisions to `docs/decisions.md` recording: the three answered OPEN questions
  (declared tile colour with a deterministic fallback, presets cut with zero migration, `4b` does not
  exist); clarify as a pre-stream exchange rather than a stage; the summary riding on the terminal
  event; and the `v2` prompt envelope.
- [ ] H2 Update the `sdk-design-system`, `app-launcher`, `prompt-flow`, `version-history`,
  `generation-contract`, `generation-server`, `generation-pipeline` and `mini-app-versioning` scope
  lines in `docs/capabilities.md` to match what these deltas actually cover.

## I. On-device verification (attended)

- [ ] I1 Run the offline release build and confirm on-device: the three faces actually resolve (a
  wrong filename falls back to Roboto silently, and no Node or Chromium suite can see it), the `2a`
  flow completes end to end against the dev server, a `4a` row renders a real stored summary through
  Whim Syntax, the off-switch flattens every screen, and the orb menu opens, counts and dismisses.
