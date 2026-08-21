## Context

Three documents fix the terrain and none of them may be re-litigated here:

- `docs/design/README.md` — the design system v2, imported into the repo as reference. Values are
  final-intent; `1a`–`1d` are a baseline recreation of the *current* app and are not a target. The
  annotated screens are `docs/design/reference/*.dc.html`.
- `research.md` §1 — the orchestrator's binding decisions: the user's answers to the three OPEN
  questions, the architecture calls, the ambiguity rulings and the placement pins. Every "D-"
  decision below cites it where it is not free-standing.
- `research.md` §2–§3 — the verbatim copy strings the deltas quote, and the current-code facts the
  tasks depend on (token structure, tile hashing, manifest extraction, test-runner discovery).

Two repo facts shape everything. First, the SDK is **tokens not values** (decision #13): mini-apps
never see a hex, only a role. Second, the `GenerationEvent.stage` enum
(`plan|generate|check|run|repair`) and the exactly-one-terminal-event invariant were ratified by
`generation-loop` and reviewed; the redesign has to fit around them, not through them.

## Goals / Non-Goals

**Goals**

- One fixed shell that is identical on every device, with saturated colour reserved for meaning.
- Whim Syntax as *one* renderer and *one* lexer — not per-screen highlighting.
- A history row that says what happened, sourced from real stored data rather than demo copy.
- The shell knows an app's colour because the app told it, once, at build time.
- Every wire and storage change backward-readable: nothing already on a device stops rendering.

**Non-Goals**

- Widening `GenerationEvent.stage`. Clarify is not a stage (D1).
- A second terminal event, a second stream, or a post-stream fetch for the summary (D2).
- Any migration pass over installed apps, stored envelopes, or existing snapshots (D3, D5).
- The orb wheel gesture, screen `4b`, and the FEEL IT experiments (see proposal, Out of scope).
- Exporting the Whim Syntax vocabulary from `vc-sdk` (D7).

## Decisions

### D1 — Clarify is a pre-stream exchange, not a generation stage

`generation-loop` ratified `stage ∈ plan|generate|check|run|repair` and stated it is not widened
even for the sibling `/v1/rewrite` change. Screen `2a`'s "clarify" step happens *before* any
generation request exists — the user has not committed to building anything yet — so modelling it
as a stage would put a pre-commitment UI step inside the post-commitment event stream and force
every conforming server to emit an event for a question it may not ask.

**Decision:** a new unary route `POST /v1/clarify`, gated by `x-whim-device` like every `/v1` route.
Prompt in → 0–3 questions out, each with its own answer options. The client collects answers and
threads them into the existing `GenerateRequest` as `clarifications`. The event stream is untouched.

**Rejected:** (a) a `clarify` stage member — reopens a ratified enum for a step that precedes the
stream; (b) SSE for clarify — a bounded question list has nothing to stream, and it would create a
second terminal-event invariant to police; (c) folding clarify into `/v1/rewrite` — rewrite already
has a distinct contract and a distinct (small, fast) model, and overloading it would make "no
questions needed" indistinguishable from "rewrite produced nothing".

**Consequence:** zero questions is a legitimate, common response. The client must skip straight from
compose to plan on an empty list, and the clarify screen must remain skippable with zero answers
("Skip these and Whim will pick sensible answers.").

### D2 — The summary rides on the terminal `result` event

The summariser output has to reach the device exactly once, tied to the run it describes, and be
persisted with that run. The stream already has an event that means "this run produced this app".

**Decision:** `result` gains `summary?: { text, kind, touched[], marks[] }`. Marks carry
`{cls: 'chg'|'hedge', start, end}` offsets into `text`. It is **optional in the schema** so the stub
pipeline and any older server stay conforming, and because history must survive its absence anyway
(D3). Stream shape — exactly one terminal event, last — is unchanged.

**Rejected:** (a) a new `summary` event before the terminal one — a stream that ends without the
terminal event (client abort) would then be able to deliver a summary for a run that produced no
app; (b) a second terminal event — breaks the ratified invariant outright; (c) a follow-up
`GET /v1/summary/:id` — the server keeps no run state (Model 1: prompts, source and bundles are
never stored), so there would be nothing to look up; (d) computing the summary on-device from the
prompt — the summary describes *what happened*, including repairs the device never saw, and the
device has no model.

**Consequence:** the pipeline must not let a summariser failure fail a run. A run whose summariser
call fails still emits its `result`, with `summary` absent.

### D3 — The prompt envelope is version-bumped and backward-readable

`prompt-flow` defines the tracked prompt as `{v: 1, text}`; `version-history` requires the history
screen to parse that envelope and fall back to the raw string; `mini-app-versioning` requires every
snapshot to carry the structured prompt; and `snapshot-lineage-identity` stamps lineage as a commit
trailer that is **stripped before `Snapshot.prompt` is surfaced** — the stamp never appears in a
returned value. The envelope therefore already has a version field, a documented fallback and a
lineage mechanism deliberately kept *outside* it.

**Decision:** `{v: 2, text, summary?}`. `text` keeps its exact current meaning — the verbatim
approved prompt — so `yours` spans can be echoed rather than reconstructed. `summary` is the
terminal event's summary object, stored beside the prompt. Every reader accepts `v1`, `v2` and a raw
non-JSON string; a row with no summary renders the prompt text, which is exactly what ships today.
The lineage stamp stays a trailer, outside the envelope, untouched.

**Rejected:** (a) a parallel summary store keyed by snapshot id — two stores to keep consistent
across rollback, fork and delete, for one string; (b) overwriting `text` with the summary — destroys
the verbatim quote the `yours` class exists to echo; (c) an unversioned additive field — the
envelope has a version field precisely so readers can branch, and a silent shape change makes the
next bump undiagnosable.

**Consequence:** no migration. A device upgrading mid-history shows summarised rows for new versions
and prompt rows for old ones, in one list, with no error state.

### D4 — Tile colour is declared, extracted once, with a deterministic fallback

The user's answer to the OPEN question is *declared*. The repo already has exactly one rule for how
a declaration reaches the host: manifests are extracted **at build time** from the literal
`defineApp` argument — "no second source of truth", and the gate reads only the host-held manifest,
never the bundle's runtime self-description (#41 D4).

**Decision:** `AppSpec.tileColor?: string` (a literal `#rrggbb`), extracted by the existing check
stage into the same `CheckedManifest` that carries capabilities, riding to the device inside
`WireAppRecord.manifest` (already an untyped record on the wire — no schema widening required), and
surfaced on the host-held `AppManifest`. When it is absent or fails hex validation the host uses
`appColor(name)`. The three status hues, the accent and `yours` are **reserved globally**: a declared
colour that collides with a reserved hue is rejected at extraction, because the design's whole
premise is that those three saturated meanings never leak.

**Rejected:** (a) deriving the colour from what the app used most — requires executing or
heuristically parsing the bundle, and spike2 forbids introspection by execution; (b) a first-class
top-level `WireAppRecord.tileColor` — a second place manifest data lives, which is the exact failure
`assembleRecord`'s single-extraction rule exists to prevent; (c) asking the model to restate the
colour in prose — same failure, one step further away from the source.

### D5 — The presets are deleted with zero migration

Six presets, ten accents and a shape picker exist today, and `theme.suite.ts` asserts over all of
them. The handoff cuts them: they put personality in the shell, where the apps should be carrying
it, and their palettes were themselves model-generated, so feeding them back as a build-time library
adds no information while looking like expertise.

**Decision:** delete `PRESETS`, `ACCENTS`, `ThemePref.preset/accent/shape` and the Settings picker.
No frozen palette, no per-app pinning, no migration code. Existing mini-apps re-skin automatically
**because they only ever resolved tokens** (#13) — this is the zero-migration option, chosen
deliberately by the user, not a consequence tolerated.

**Consequence:** `sanitizeTheme` stays. It is a trust boundary (the theme global is
attacker-controlled inside the iframe), not a preset mechanism, and deleting it would widen the
sandbox surface for an unrelated reason. `resolveTheme` collapses to returning the one fixed theme.
`theme.suite.ts`'s "every preset resolves" and "every accent swaps" assertions are expected breaks,
replaced by assertions that the fixed theme carries the v2 values and that no retired hex remains.

### D6 — `appColor(name)` lives in the SDK theme module and is the only name→hue function

The prose renderer must colour a mention of "Pour Timer" with the same hue the grid paints its tile,
or the strongest tie between prose and grid is a coincidence. Two implementations of "the app's
colour" is how that tie silently breaks.

**Decision:** one exported pure function in the SDK theme module (`src/sdk/theme.ts` or a sibling it
re-exports), imported by the grid, by the declared-colour fallback and by the prose renderer. Its
palette is a fixed set of saturated hues that **excludes** `working`/`broken`/`waiting`, `accent`
and `yours`, for the same reservation reason as D4. `src/host/launcher/tiles.ts` keeps `monogram`
and delegates its colour to this function rather than owning `TILE_COLORS`.

**Placement note:** the SDK theme module is already "one source file, two hosts" — imported by both
`vc-sdk` and the RN launcher — so it is the only existing module both sides already reach.

### D7 — Whim Syntax is shell-side, one renderer, one lexer, caps enforced in the renderer

**Decision:** the lexer and renderer live under `src/host/` (`src/host/ui/whim-prose/`), **not** in
`vc-sdk`. The marks vocabulary is shell semantics — it describes what the *product* is telling you
about a change — and exporting it from `vc-sdk` would widen the mini-app SDK surface for no product
reason and invite mini-apps to render shell-meaning colours inside their own UI, where the three
status hues do not mean the same thing.

Four classes are **deterministic on the client** and need no model: `app` (match the installed-app
list), `measure` (number/duration/version pattern), `yours` (match against the stored verbatim
prompt for that change), `state` (fixed three-word vocabulary). Only `chg` and `hedge` are
model-tagged (D2).

The discipline rules are enforced **in the renderer**, not merely prompted for, because a prompt is
not a guarantee and the failure mode is invisible: four system marks per sentence hard cap;
`yours` exempt from the cap and the only span allowed two channels (italic + colour); one channel
per span; one colour per sentence; agent prose only — labels, buttons, settings and headings are
never marked; never lexed live in a field being typed, only after submission. Marks beyond a cap are
dropped to flat text, never truncated mid-span.

**Rejected:** (a) per-screen highlighting — the rule set is the feature, and five copies of it
diverge on the first deadline; (b) trusting the model's mark count — the cap is a rendering
guarantee, and the source cap is a second belt, not the belt; (c) lexing in the composer as the user
types — explicitly forbidden by the design ("the keyboard arguing with you"), and it would highlight
a prompt that has not been submitted, so `yours` would have nothing to match against.

**Off-switch:** a single persisted launcher setting rendering all prose flat, living on the Settings
screen where the preset picker was. It is both the accessibility answer and the only honest way to
run the "does highlighting stay signal at volume" experiment later. Rule 5 — every string must stay
unambiguous rendered flat — is a test obligation, not just a writing note.

### D8 — Fonts are static TTFs resolved by filename

Android resolves `fontFamily` against the asset file's base name, and it does not synthesise italic
from a roman face the way the web handoff's `@font-face` assumes. Newsreader is used *only* italic.

**Decision:** static TTFs in `android/app/src/main/assets/fonts/` —
`InstrumentSans-{Regular,Medium,SemiBold,Bold}`, `IBMPlexMono-{Regular,Medium}`,
`Newsreader-Italic` — with canonical copies under `assets/fonts/` at the repo root. No
`react-native.config.js`, no `react-native-asset` dependency, `package.json` untouched (it is
Class 2 and no agent may edit it).

**Consequence:** "upright brown" — the user's words standing alone as a block — is **Instrument
Sans** in `yours` `#a15c07`. Newsreader is italic-only and appears only inside a sentence Whim
wrote. There is no upright Newsreader anywhere.

### D9 — Skeleton geometry is imported, never duplicated

The design's rule is that skeleton geometry must be generated from the same size constants as the
real component, or the layout jumps on load and the skeleton was a lie.

**Decision:** each component whose loading state is drawn exports its size constants (tile edge,
radius, gap, row height); the skeleton imports them. A literal in a skeleton style is the defect.
`breathe` (1.9s ease-in-out infinite, opacity 0.34 → 0.72) is the only loading motion — no shimmer
sweep, no travelling gradient. Grid skeletons use exact tile geometry and the known count; plan-row
skeletons use **varying** widths, because identical bars read as a progress bar. A skeleton is only
shown when the thing is genuinely coming *and* its shape is already known — never for an empty
result or a state that may never fill.

### D10 — The plan screen is the rewrite endpoint's surface, with optional structured rows

Screen `2a`'s plan is four labelled rows (`What it is`, `The screen`, `When a step ends`,
`What it remembers`). `RewriteResponse` carries one string. The plan screen is functionally the
successor of today's rewrite-preview screen — the last approval gate before generation spends
tokens — so it should not become a second endpoint.

**Decision:** `RewriteResponse` gains an **optional** `plan: { label, text }[]`. When present the
plan screen renders the rows; when absent it renders `rewrittenPrompt` as a single row. The clarify
answers are sent with the rewrite request so the plan reflects them. "Tap anything to change it"
re-opens the composer prefilled with that row's text — nothing fancier (ruling).

**Judgment call — flagged.** The orchestrator ruled on clarify and on the summariser but not on
where the plan rows come from. This is the smallest additive option that keeps one approval gate and
one endpoint; the alternative (a second structured endpoint, or making the plan client-computed from
the clarify answers as the prototype does) was rejected as either a new round trip or fabricated
content the generator never agreed to.

### D11 — Nothing destructive is one tap away

Today `version-history` specifies that tapping a row restores instantly with a toast Undo. The
redesign reverses that: tapping a row **expands** it, and restore is one of at most two explicit
actions inside, behind a confirm sheet. In every confirm sheet the **safe** option is the large
button and the consequential action is demoted to plain text.

**Decision:** adopt the redesign. Instant-restore-with-undo is replaced, not kept alongside — two
restore paths with different safety properties on one screen is worse than either. Undo does not
survive as a toast because there is no longer an unconfirmed action to undo; the confirm sheet's
body says what comes off and that it can be come forward from again.

**Consequence — flagged.** The redesigned row surfaces **exactly two** next actions ("the two things
you'd want to do next"), which leaves no surface for named pins. The `version-history` delta removes
that requirement rather than leaving a shipped feature with no way to reach it. This is a judgment
call the orchestrator did not cover and is called out in the report.

### D12 — The orb ships as the tapped menu, instrumented

The design itself says to ship the plain tapped menu first and instrument it: how many actions
belong on the wheel, and which, is FEEL IT.

**Decision:** the menu ships with cheap, undoable actions only — nothing destructive by gesture or
by menu row; delete, rename and restore each need a screen and a sentence. Per-action tap counts are
persisted through the launcher's existing key-value path, so the wheel's default set is later chosen
from data. The wheel's "down" target is the versions sheet (the prototype's coded behaviour), since
`4b` does not exist. Wheel gesture code is not built.

**Rejected:** shipping the wheel's teaching affordances (per-row "up/right/down/left" hints, "Hold
the button next time to flick straight to one") — they advertise a gesture that does not exist,
which is the same defect as "Coming soon." copy that `app-launcher` already forbids.

### D13 — Every new test joins an existing runner

`package.json` is Class 2; no agent may add an npm script. New suites are registered the way each
runner already discovers them: launcher suites are imported into
`src/host/launcher/test/acceptance.ts`; SDK suites are named `*.acceptance.ts(x)` under
`src/sdk/test/` and are auto-discovered; server suites join the server acceptance entry. A task that
cannot be verified without a new script is mis-scoped.

## Risks / Trade-offs

- **`theme.suite.ts` breaks by design.** Its structural assertions iterate `PRESETS`/`ACCENTS`. The
  replacement must be non-vacuous: assert the fixed theme's v2 values and assert that the retired
  `#4f46e5` and Space Grotesk appear nowhere in `src/`, so the retirement cannot silently regress.
- **Fonts fail silently on Android.** A wrong filename falls back to Roboto with no error. The
  authoritative check is on-device, not in a Node suite; the desktop invariant suites cannot see it.
- **`chg`/`hedge` are model-authored.** A model that over-marks degrades reading. The renderer cap
  is the guarantee; the source cap only reduces waste. Both are specified.
- **`yours` matching is exact-substring against the stored verbatim prompt.** A summariser that
  paraphrases the user produces no `yours` span rather than a wrong one — the correct failure
  direction (the class is attribution; a paraphrase attributed to the user is a lie).
- **One-line summaries may prove too thin.** The design says build one line first — cheaper to grow
  out of than to shrink back into.
- **`LauncherRoot.tsx` is a hand-rolled screen union with no navigation library.** The `2a` flow is
  a restructure of that union, not a leaf component, so it is one chain's exclusive property and
  every other chain plugs in through its declared contract.

## Migration Plan

None is required, and that is the design.

- **Installed mini-apps** re-skin on next launch because they resolve tokens, not values (D5).
- **Stored envelopes** keep rendering: `v1` and raw strings fall back to prompt text (D3).
- **Apps with no declared colour** — every app installed before this change — fall back to
  `appColor(name)`, which is the same deterministic mapping the grid uses today (D4, D6).
- **Theme preferences** persisted under the old key are ignored; an absent or unreadable preference
  was always a legitimate state that resolves to defaults, so no cleanup pass runs.

## Open Questions

- Does the plan screen's row set stay four rows for every app, or does the rewrite model choose the
  labels? Shipped as model-chosen labels with a single-row fallback (D10); the fixed four are the
  prototype's example, not a contract.
- How many actions the orb menu should carry is deliberately unanswered — that is what the
  instrumentation is for (D12).
