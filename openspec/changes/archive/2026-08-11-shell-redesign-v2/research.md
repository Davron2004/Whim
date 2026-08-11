# Research digest: shell-redesign-v2

Provenance. Three inputs, in precedence order:

1. **`scratchpad/orchestrator-decisions.md`** — binding decisions from the orchestrator, reproduced
   verbatim in §1 below because they are the only source that is not otherwise in the repo.
2. **`docs/design/README.md`** — the design system v2 spec, in-repo, cite it directly for token
   values, Whim Syntax rules, voice rules, empty/loading rules and the screen index.
3. **`scratchpad/design-extract.md`** (per-screen values and copy read out of the prototype source)
   and **`scratchpad/code-map.md`** (current-code facts). The load-bearing extracts are in §2 and
   §3; the prototypes themselves are at `docs/design/reference/*.dc.html`.

---

## 1. Orchestrator decisions (verbatim, binding)

### Answered OPEN questions (user decisions)

1. **Tile colour is DECLARED by the app.** One hex in the app manifest (extracted at build time
   alongside capabilities — no second source of truth). The deterministic name→colour function
   remains only as the fallback for apps with no declaration.
2. **Legacy preset apps: re-skin everything now.** The six presets are deleted with no
   frozen-palette migration. Because the SDK is tokens-not-values (decision #13), existing mini-apps
   automatically render under the new fixed shell values — this is the zero-migration option, chosen
   deliberately. No per-app palette pinning code.
3. **Screen 4b does not exist.** History 4a only. The orb wheel's "down" gesture in the prototype
   that landed on 4b instead opens the versions sheet (as the prototype code already does).

### Architecture calls

- **Clarify is a pre-stream exchange, not a stage.** generation-loop ratified the
  `GenerationEvent.stage` enum (plan/generate/check/run/repair) and the one-terminal-event
  invariant; we do not reopen it. New request/response endpoint (e.g. `POST /v1/clarify`): prompt in
  → 0–3 clarifying questions out (stub server: deterministic). Client collects answers, then starts
  the existing generation stream with prompt + clarifications. Gated by `x-whim-device` like every
  `/v1` route.
- **The summary rides on the terminal event.** The post-run summariser output is a field on the
  existing terminal `GenerationEvent`: `{ text, marks: [{cls: 'chg'|'hedge', …}] }`, ≤1 `chg` and ≤1
  `hedge` per sentence at the source, cap re-enforced in the renderer. Stream shape (exactly one
  terminal event) unchanged.
- **Storage: extend the prompt envelope, version-bumped, backward-readable.** Verbatim prompt
  already persists (`Snapshot.prompt`, envelope-wrapped; snapshot-lineage-identity defines the
  current scheme). Add the summary alongside it. v1 envelopes (no summary) must still render:
  history row falls back to prompt text.
- **Highlighting off-switch** is a launcher setting (SettingsScreen keeps this toggle; the
  preset/accent picker is removed).
- **Skeletons import the same size constants as the components they stand in for** — export the
  constants from the component module, never duplicate values.
- **Orb ships as the tapped menu** (the prototype's non-gesture fallback), instrumented: per-action
  tap counts persisted via the launcher's existing persistence path. Wheel gesture code is NOT built
  in this change. Menu carries only cheap, undoable actions.
- **Fonts:** static TTFs in `android/app/src/main/assets/fonts/` (Android resolves `fontFamily` by
  filename): `InstrumentSans-{Regular,Medium,SemiBold,Bold}`, `IBMPlexMono-{Regular,Medium}`,
  `Newsreader-Italic`. Canonical copies also live in `assets/fonts/` at repo root. No
  `react-native-asset` dependency; `package.json` untouched.
- **"Upright brown"** (user's words standing alone as a block) is Instrument Sans in `yours`
  `#a15c07` — Newsreader is italic-only, per the type table.
- **One OpenSpec change: `shell-redesign-v2`.** It supersedes the UI halves of prompt-flow-ux and
  version-history-ux; their spec deltas are synced to live specs first, then this change MODIFIES
  those requirements.

### Ambiguity rulings

- Composer caret/CTA colour: **accent violet `#3f3d8f`** everywhere (the teal in 3a's sheet is the
  inconsistency; teal is reserved for status).
- 4a history headline: render through Whim Syntax like the DS doc's flagship example (the plain-text
  prototype row is the stale side).
- "Changed" badge tint: derive from the v2 accent, not retired indigo.
- Orb fan timing: honour the doc (180 ms) over the prototype code.
- 4a filter pills: DO build them (computed-but-unrendered reads as unshipped, and they are cheap);
  "All N" count live, others by summariser kind.
- Done screen: "Open it" opens the app; "Back to your apps" goes home. Wire them distinctly even
  though the mock aliased both.
- Plan-row "tap to change it": in-scope only as re-opening the composer prefilled with that plan
  row's text; nothing fancier.

### Placement pins

- **`appColor(name: string): string` lives in the SDK theme module** (`src/sdk/theme.ts` or a
  sibling it re-exports) — a pure deterministic function; the grid, tile fallback and prose renderer
  all import this one symbol. It draws from a fixed palette of saturated hues that excludes the three
  reserved status hues and the shell accent/`yours` colours.
- **The Whim Syntax renderer + lexer live under `src/host/` (shell-only), NOT in vc-sdk.** The marks
  vocabulary is shell semantics; exporting it from vc-sdk would widen the mini-app SDK surface for no
  product reason. Suggested home: `src/host/ui/whim-prose/`.
- **Tests join existing suites.** `package.json` is protected — no agent can add npm scripts. New
  tests must be discovered by the existing runners (`launcher:test`, `sdk:test`, `server:test`,
  `bridge:test`).

---

## 2. Copy strings the deltas quote (from the prototypes, verbatim)

**Screen 2a — compose**: headline `What should it do?` (explicit two-line wrap in the mock);
helper `Plain words are enough. Whim will ask if something is unclear.`; eyebrow `Or start from`;
chips `a timer with my pour-over recipe` / `a tracker for how often I water the plants` /
`a dice roller for game night`; primary `Continue`.

**Screen 2a — clarify**: headline `Two quick things` (the two-question form); helper
`Skip these and Whim will pick sensible answers.`; primary `Continue`. Sample questions:
`Should it remember past brews?` → `Keep a history` / `Just the last one`;
`How should it tell you a step is done?` → `Sound` / `Buzz` / `Both`. Single-select, no clear.

**Screen 2a — plan**: headline `Here's the plan`; subhead `Tap anything to change it before
building.`; row labels in the sample `What it is` / `The screen` / `When a step ends` /
`What it remembers`; footer `Nothing here is final — you can keep changing the app after it's
built.`; primary `Build it`.

**Busy label (all forward steps)**: `One moment`.

**Screen 2a — build**: title `Making it`; sub `This takes about a minute. You can leave and come
back.`; four steps `Reading your plan` → `Writing the app` → `Checking it runs safely` →
`Putting it on your home screen`; secondary `Leave it running`.

**Screen 2a — done**: title `Pour Timer is ready` (i.e. `<App name> is ready`); body `It's on your
home screen. Open it, or tell Whim what to change.`; primary `Open it`; secondary
`Back to your apps`.

**Screen 2a — home**: title `Whim`; eyebrow `Your apps`; composer row placeholder
`Describe an app…`.

**Screen 4a — history**: header `<App name in its own hue> history` over `7 versions · started 3
days ago` (i.e. `<N> versions · started <when>`); origin lines `You said` and `Whim, on its own`;
current marker `↑ you're on this one`; expanded eyebrow `What it touched`; actions `Change it from
here` (current version, one action), `Go back to this` + `Start a copy here` (past version, two
actions); filter pills `All 7` / `What it does` / `Look` / `Fixes`; kind badges `Added`, `Changed`,
`Removed`, `Look`, `Fixed`, `Start`.

**Screen 4a — confirm sheets**: fork title `Start a second app from {v}?`, body `You'll have two
Pour Timers. The one you're using now stays exactly as it is.`, CTA `Make the copy`, toast
`Copy made — it's on your home screen`. Rollback title `Go back to {v}?`, body `Everything after
{v} comes off — including {the specific thing when known | the last few changes}. Your saved brews
stay. You can come forward again from this list.`, CTA `Go back to it`, toast `You're on {v} now`.
Both sheets: the big button is `Cancel` (the safe option); the consequential action is plain text
beneath it.

**Voice table** (`docs/design/README.md`): waiting `Rummaging.`; change landed `Nudges you before
the last pour.`; fixed after a stumble `Countdown had a taste for negative numbers. Fixed on attempt
two.`; broken and staying broken `Didn't run. I've stopped trying. Your last working version is
here.`

---

## 3. Current-code facts the tasks depend on

- **`src/sdk/theme.ts`** (263 lines) is imported by BOTH the SDK (`src/sdk/tokens.ts`) and the RN
  launcher (`src/host/launcher/theme.ts`) — "one source file, two hosts". It holds `WhimTheme`,
  `ThemePref {preset, accent?, shape?}`, `PRESETS` (6), `ACCENTS` (10), `RADIUS_SCALE`,
  `resolveTheme`, `DEFAULT_THEME`, `sanitizeTheme`. `#4f46e5` lives at `theme.ts:78` (paper preset
  primary) and `theme.ts:171` (indigo accent) — the only two live source occurrences; the third is
  an owner-authored invariants fixture that no feature agent touches.
- **`sanitizeTheme` is the sandbox trust boundary**, validating the attacker-controlled
  `globalThis.__WHIM_THEME__` field-by-field. It is not a preset mechanism and is kept.
- **`src/sdk/tokens.ts`** defines `FONT = 'system-ui, -apple-system, sans-serif'` — the SDK's entire
  typeface story today, because CSP forbids remote font loading inside the sandboxed iframe.
- **No font infrastructure exists.** No `react-native.config.js`, no `.ttf` anywhere, no `assets/`
  dir. Every launcher screen sets `fontSize`/`fontWeight` only and falls through to Roboto. Android
  resolves `fontFamily` by asset file base name and does not synthesise italic from a roman face.
- **`src/host/launcher/tiles.ts`** (42 lines): `TILE_COLORS` (8 fixed hexes), `tileColor(name)` =
  djb2 of the display name mod 8, `monogram(name)`. `HomeScreen.tsx` documents this as the one
  deliberate exception to "every colour comes from `shellPalette(theme)`".
- **No navigation library, no state library.** `LauncherRoot.tsx` holds one `Screen` discriminated
  union in `useState` and an `if/else if` chain picks the component. The `2a` flow is a restructure
  of that union, not a leaf component.
- **Verbatim prompt storage already exists**: `LauncherRoot.tsx` wraps the approved text as
  `JSON.stringify({v:1, text})` and passes it to `StoreAccess.install`/`.update`;
  `prompt-envelope.ts` parses it tolerantly (raw string fallback); `HistoryScreen.tsx` renders
  `parsePromptEnvelope(snapshot.prompt).text`. **No summary field exists anywhere.**
- **`AppManifest`** (`src/host/bridge/contract.ts:250`) is currently `{ capabilities: string[] }` —
  host-held and harness-trusted: "the gate reads ONLY this, never the bundle's runtime
  self-description". `WireAppRecord.manifest` is an untyped `z.record` on the wire, so a declared
  colour rides it without a schema change.
- **Manifest extraction is build-time and server-side**: `server/src/generation/stages/check.ts` →
  `CheckedManifest` → `record.ts#assembleRecord`, which reads the already-extracted manifest
  verbatim and never re-parses. One extraction.
- **Test runners**: `launcher:test` bundles a single `src/host/launcher/test/acceptance.ts` that
  imports each suite explicitly — a new launcher suite is registered by adding an import there.
  `sdk:test` auto-discovers `*.acceptance.ts(x)` under `src/sdk/test/`. `server:test` type-checks
  both workspaces then bundles the server acceptance entry. `package.json` is Class 2: no new npm
  script may be added by any agent.
- **`theme.suite.ts` breaks by design.** It iterates `Object.keys(PRESETS)` and `Object.keys(ACCENTS)`
  asserting every preset resolves and every accent swaps exactly `primary`/`on-primary`; cutting the
  catalogue removes what those assertions are about.
