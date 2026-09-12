# Research: the theme picker was cut, but its code shape wasn't

Researcher digest, 2026-09-11. Triggered by a source-comment audit of `src/host/launcher/` that
turned up a doc comment describing a feature the repo already deleted.

## What #59 actually cut, and what it left behind

Decision #45 (`docs/decisions.md:524`) built `sdk-design-system`'s theme picker: 6 curated presets,
10 accent pairs, 3 corner shapes, persisted as a `ThemePref` under `whim.theme:v1`
(`docs/decisions.md:531`). Decision #59 (`docs/decisions.md:888`, `shell-redesign-v2`) replaced it
with a fixed, non-themeable v2 token set and states the cut plainly: "the six presets and ten
accents are cut with zero migration... the zero-migration path was the user's deliberate choice"
(`docs/decisions.md:906-909`). But #59's own text records the cut as an outcome of adopting the v2
design, not as a numbered decision in its own right — there is no entry that says "the picker's
*code shape* — context, hook, palette-as-parameter — is retired along with the picker."

The live specs already reflect the fixed theme: `openspec/specs/sdk-design-system/spec.md:10`
("no theme catalogue"), `:79`, `:93-94`; `openspec/specs/app-launcher/spec.md:221-233`, whose
requirement heading is "A launched mini-app receives the active theme at delivery" and whose body
says "There is no user theme preference to resolve: the shell is fixed, identical on every device,
and the delivered theme is the same on every launch."

## What survived despite that

- `src/host/launcher/theme-context.tsx` — `ThemeProvider`/`useTheme()` still exist, still return a
  `{ theme: WhimTheme }` shape, still get imported by 15 other files under `src/host/launcher/`
  (`git diff --name-only` filtered to files whose diff removes a `from './theme-context'` import;
  16 files touched counting `theme-context.tsx` itself — the file's own header comment even says
  why: "so every screen that already reads `const { theme } = useTheme()` keeps working unchanged").
  The value is always `DEFAULT_THEME` (`theme-context.tsx:16`), so the context carries no
  information a module constant wouldn't.
- `src/host/launcher/theme.ts` — `shellPalette(theme: WhimTheme): ShellPalette` is a function that
  takes a theme parameter, but every call site passes `DEFAULT_THEME` (via `useTheme()`, which
  always returns it). `grep -rn "shellPalette(" src/host/launcher --include='*.tsx'` turns up nine
  call sites, none of which ever supplies anything other than the fixed theme.
- The palette is then threaded as an explicit prop or argument in several more places, none of
  which need to vary it because there is only one value it can ever be:
  - `app-tile.tsx:97` — `pill?: { kind: TilePillKind; palette: ShellPalette; onPress?: () => void }`
    (new in PR #31, the tile-pill work).
  - `tile-pill-view.tsx:21` — `TilePillProps.palette: ShellPalette`.
  - `HomeScreen.tsx:306` — `GhostActionRow`'s `palette: ShellPalette` prop.
  - `flow-chrome.tsx:23,54,81` — `FlowHeaderProps.palette`, `PrimaryActionProps.palette`,
    `EditingEyebrowProps.palette`, all `ShellPalette`.
  - `FailureScreen.tsx:101,107` — `segmentColor(segment, p: ShellPalette)` and
    `rowIcon(kind, p: ShellPalette)`, both taking the palette as a parameter.
  - `LauncherRoot.tsx` — `DevLogTools({ palette })`.
  - `HistoryScreen.tsx` — `HistoryRowView`, `ActionButton`, `ConfirmBody`, and
    `HistoryLoadingRows` each take a `palette: ShellPalette` parameter.
- Four suites had a source-regex assertion that locked the wrong direction, encoding "every screen
  must call `shellPalette(theme)`" as the invariant instead of "every screen must read one constant":
  `failure-screen`, `observability-ui`, `run-timeline`, and `prompt-flow-screens` (their suite files
  under `src/host/launcher/test/`) — `prompt-flow-screens.suite.ts` had a source regex matching
  `PrimaryAction`'s now-removed `palette` prop directly in a `<PrimaryAction ... palette ...>` call
  it asserted against.

## The drift mechanism, named

`app-tile.tsx:87-97`'s doc comment on the `pill` prop reads: "Carries its own `palette` rather than
this tile deriving one — the caller (`HomeScreen`) already resolves a `ShellPalette` from whatever
theme it's given, and threading that same value through is what keeps a future theme picker from
leaving the pill on a stale default." That sentence is the drift mechanism. It was written after
#59 cut the picker, about a prop added after #59 cut the picker, and it justifies the pattern by
appeal to a picker that no longer exists. An agent reading `useTheme()` returning a `{ theme }`
plus a `shellPalette(theme)` function that takes an argument has every reason to infer themes vary
at runtime, and to thread the derived value into whatever it builds next — which is exactly what
happened at every one of the sites listed above after the picker was gone.

## What must not move

Mini-app delivery theme (the `__whimHostInit` payload, `openspec/specs/app-launcher/spec.md:221-233`),
`sanitizeTheme` and `appColor` (`src/sdk/theme.ts`), `__WHIM_THEME__`, and the tile-colour system
(`appColor(name)` / declared `tileColor`) are a separate mechanism — the SDK-side theme contract
mini-apps render against — and are untouched by this change. This change is scoped to the RN
launcher shell's own internal plumbing for its own screens.

One launcher component genuinely does take a theme as a prop, and it is not part of the drift:
`MiniAppView.tsx:33`'s `theme: WhimTheme` prop is the resolved launcher theme forwarded *opaquely*
into mini-app delivery — required by `openspec/specs/app-launcher/spec.md`'s own "A launched
mini-app receives the active theme at delivery" requirement (spec.md:232, "the delivered init
payload SHALL carry the fixed v2 theme"). `MiniAppView` never derives a `ShellPalette` from it or
threads it further into the shell's own rendering; it hands the same fixed theme onward, unopened,
to the delivery path. The new invariant must carve this one prop out explicitly rather than
contradict the delivery requirement.

## Historical mentions that must stay

Three references to the pre-redesign, picker-era screens are historical record, not live drift,
and this change does not touch them:
- `docs/design/README.md:234` — describes the pre-redesign screens in a section marked "do not
  build".
- `docs/design/reference/Whim Mobile.dc.html:611` — same era, same "do not build" framing.
- `openspec/changes/archive/2026-08-11-shell-redesign-v2/tasks.md:64` — a completed task from the
  change that did the cut.

## Where tests belong

- The tripwire against reintroduction belongs in `src/host/launcher/test/theme.suite.ts` — the
  suite already carries a source-scan tripwire for a different retired surface (the `#4f46e5` hex
  and `Space Grotesk` face, per `sdk-design-system` "The retired indigo is gone from source"), but
  that existing scan (`everySourceFile`, `theme.suite.ts:20-32`) walks all of `src/`, not just the
  launcher — the new theme-picker tripwire is scoped tighter, to `src/host/launcher/` only, since
  the picker's code shape is a launcher-only concern.
- The four suites whose regex asserted `shellPalette(theme)` (or, for `prompt-flow-screens`, a
  `palette` prop) per screen — `failure-screen`, `observability-ui`, `run-timeline`, and
  `prompt-flow-screens` — need their assertions flipped to check for `SHELL_PALETTE` usage instead,
  or removed if the check becomes redundant with the whole-launcher tripwire.

## Root cause and the fix shape

Cutting a feature's user-facing surface (the picker screen, the persisted pref) while leaving its
code shape in place (a context that always resolves to one value, a function that always receives
one argument, props that always carry one palette) does not remove the feature — it leaves a fully
wired socket for someone to plug a second value back into. The fix is not a policy or a comment; it
is deleting the shape (module constant, not context; no palette parameter; no palette props) and
adding a static tripwire that scans `src/host/launcher/**/*.ts(x)` (excluding `test/`) and fails,
naming the offending file, on any of: the phrase "theme picker", `useTheme`, `ThemeProvider`,
`ThemePref`, `shellPalette(`, or the identifier `ShellPalette` appearing anywhere outside
`theme.ts` itself (not just in a prop/param position — `theme.ts` is the only file allowed to name
the type at all, in its interface declaration and the constant's own annotation), with a
non-vacuity assertion that the walk actually reaches and inspects `LauncherRoot.tsx` and
`HomeScreen.tsx` — proof the scan is exercising real files rather than passing vacuously on an
empty or misconfigured file list. `MiniAppView.tsx`'s `theme: WhimTheme` prop (see "What must not
move") is a distinct type, not `ShellPalette`, so it is unaffected by this rule.
