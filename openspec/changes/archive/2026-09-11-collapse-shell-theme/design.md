## Context

Grounded in `research.md` (researcher digest, 2026-09-11). Two facts from it drive every decision
below.

1. `#59` cut the theme picker's user-facing surface (presets, accents, shapes, the persisted
   `ThemePref`) but never recorded the cut of its *code shape* as a decision, and the code shape —
   a context that always resolves to one value, a function that always takes one argument, and a
   family of props/parameters across `app-tile.tsx`, `tile-pill-view.tsx`, `HomeScreen.tsx`,
   `flow-chrome.tsx`, `FailureScreen.tsx`, `LauncherRoot.tsx`, and `HistoryScreen.tsx` that all
   carry one palette — survived and kept growing after the cut.
2. The growth has a named cause: `app-tile.tsx`'s doc comment justifies its `palette` prop by
   appeal to "a future theme picker" that no longer exists. That sentence is the drift mechanism,
   not just a symptom of it.

Settled ground not re-litigated: the v2 theme is fixed and non-themeable (#59); mini-app delivery
theme, `sanitizeTheme`, `__WHIM_THEME__`, and the tile-colour system are a separate SDK-side
contract untouched here (`openspec/specs/app-launcher/spec.md` "A launched mini-app receives the
active theme at delivery").

## Goals / Non-Goals

**Goals:**
- One module constant for the shell palette; no code path left that could hold a second value.
- Delete the context, the parameterized function, and every prop/argument that threads a palette
  through, rather than leaving them in place and merely not using them.
- A tripwire that fails a build the moment any of the retired shapes reappears, naming the file.
- Zero visible change: every screen already renders `DEFAULT_THEME`'s derived palette; this only
  changes how that one value reaches each screen.

**Non-Goals:**
- Anything about the mini-app delivery theme, `sanitizeTheme`, `appColor`, or the tile-colour
  system — a different mechanism, untouched.
- Reopening whether the shell should ever be themeable again — settled by #59.
- Rewriting the historical design-doc mentions of the picker-era screens — they are dated record,
  not live drift (research.md "Historical mentions that must stay").

## Decisions

**D1 — A module constant, not a context.** `theme-context.tsx`'s only reason to exist was to let
15 other files keep writing `const { theme } = useTheme()` unchanged after #59 fixed the value
(`theme-context.tsx`'s own header comment says so). A React context whose value never varies buys
nothing a plain export doesn't, and it is precisely the shape that reads as "this could vary" to
the next person editing the file. `theme.ts` exports `SHELL_PALETTE: ShellPalette`, computed once
from `DEFAULT_THEME` at module load. Consumers that need the full `WhimTheme` (not just the derived
palette) import `DEFAULT_THEME` from `../../sdk/theme` directly — the same value `theme-context.tsx`
was already wrapping.

**D2 — Delete `shellPalette(theme)`, don't just stop calling it with a non-default argument.**
Keeping the function and always calling it with `DEFAULT_THEME` would preserve the exact shape that
invites a second caller to supply something else. Its logic (mapping `WhimTheme.colors` roles onto
`ShellPalette` fields) is inlined once, at `SHELL_PALETTE`'s definition site, and the function is
removed.

**D3 — Every palette prop/argument is removed, not defaulted.** The threading sites —
`app-tile.tsx`'s `pill.palette`, `tile-pill-view.tsx`'s `TilePillProps.palette`, `HomeScreen.tsx`'s
`GhostActionRow` palette prop, `flow-chrome.tsx`'s `FlowHeaderProps`/`PrimaryActionProps`/
`EditingEyebrowProps.palette`, `FailureScreen.tsx`'s `segmentColor`/`rowIcon` palette parameters,
`LauncherRoot.tsx`'s `DevLogTools({ palette })`, and `HistoryScreen.tsx`'s `HistoryRowView`/
`ActionButton`/`ConfirmBody`/`HistoryLoadingRows` palette parameters — each read `SHELL_PALETTE`
directly at their point of use instead of receiving it from a caller. A default parameter value
would still type-check a caller that passes something else; removing the parameter entirely does
not. This is the same "keeps a future theme picker from leaving the pill on a stale default"
comment inverted: with no parameter, there is no stale-default failure mode to guard against,
because there is nothing to pass. `MiniAppView.tsx`'s `theme: WhimTheme` prop is not one of these
sites — it forwards the theme opaquely into mini-app delivery, a requirement of
`app-launcher/spec.md`'s delivery contract, not a shell-rendering palette (research.md "What must
not move").

**D4 — The tripwire lives in `theme.suite.ts`, scans launcher source only, excludes tests.** The
suite already carries a different source-scan tripwire, over all of `src/` — the `#4f46e5` hex and
`Space Grotesk` face check, under `sdk-design-system` "The retired indigo is gone from source" — so
the theme-picker tripwire is one more case in the same file, not a new one, but with its own
narrower scan root: `src/host/launcher/**/*.ts(x)`, excluding `test/`. It fails, naming the file,
on: the phrase "theme picker", `useTheme`, `ThemeProvider`, `ThemePref`, `shellPalette(`, or the
identifier `ShellPalette` appearing anywhere outside `theme.ts` — not just typed onto a prop or
parameter, but named at all — since `theme.ts` is the only file permitted to name the type, in its
interface declaration and the constant's own type annotation. A non-vacuity assertion confirms the
walk actually inspects `LauncherRoot.tsx` and `HomeScreen.tsx`, so the check can't pass by silently
matching nothing. Excluding `test/` is necessary — the tripwire's own source and this proposal's
own docs would otherwise trip it by naming the retired identifiers. `MiniAppView.tsx`'s
`theme: WhimTheme` prop types a different identifier, so it does not trip this rule.

**D5 — The four per-screen suites get their assertion inverted, not deleted.** `failure-screen`,
`observability-ui`, `run-timeline`, and `prompt-flow-screens` each asserted "this screen calls
`shellPalette(theme)`" or matched a `palette` prop directly — true before this change, but the
wrong invariant: it locks in the parameterized shape this change removes. Each is rewritten to
assert "this screen uses `SHELL_PALETTE`" so the suites keep proving something (the screen renders
from the one true palette) rather than becoming dead weight.

## Risks / Trade-offs

- [15 other files is a wide blast radius for one change] → Each edit is mechanical (replace
  `useTheme()` + `shellPalette(theme)` with `SHELL_PALETTE`, or replace a `palette` prop read with
  the same constant) and every rendered value stays byte-identical, since every call site already
  resolved to `DEFAULT_THEME`. No screen's visual output changes.
- [The tripwire's string-match on "theme picker" could false-positive on a legitimate future
  mention, e.g. a decisions.md excerpt copied into a code comment] → Scoped to `src/host/launcher/`
  source only, excluding `test/`; docs and `openspec/` are outside its scan root by construction.
- [A rename could dodge the "`ShellPalette` named nowhere outside `theme.ts`" rule, e.g. a type
  alias] → Out of scope for a source-text tripwire; accepted the same way the existing indigo/font
  tripwire accepts a hex value split across concatenated strings. A structural (AST-based) version
  is a possible follow-up if this one proves gameable in practice.

## Migration Plan

None. No wire change, no schema change, no persisted state (the `ThemePref` MMKV key was already
orphaned by #59 and is untouched here). This is a same-PR internal refactor: delete the shapes,
add the tripwire, flip four assertions. Rollback is a plain revert.

## Open Questions

None. The shape to delete and the invariant to enforce are both fully specified by the code
already in the repo (research.md).
