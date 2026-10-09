# Critique response

Phase C1 of `design-system-v1`. The critique of 2026-10-09
(`Whim-evidence/design-critique-2026-10-09/CRITIQUE.md`, reviewed at `adf90fa7`) raised 33 findings. This file
gives each one a verdict and points to where `01`–`06` and the mockups now answer it. Section numbers refer to
the revised docs; `#s-…` ids open the screen in `docs/design/mockups/index.html`. Nothing was rejected. Six
findings are partial: the problem is accepted and fixed, but not the critique's exact remedy.

| # | Severity | Finding | Verdict | Reason | Fixed in |
|---|---|---|---|---|---|
| 1 | BLOCKER | Three tints are the status colours | ACCEPT | Ten cool tints, each ≥ 20.3 ΔE2000 from every status form and ember (≥ 10 under CVD); status gets a shape: danger never fills, badges carry icons | `01` §2.2, §3.3, §3.4; `03` Button, Badge; `04` Choosing well; `#s-gallery-type` |
| 2 | BLOCKER | Back over a running app reverses #67 silently | PARTIAL | #67 kept over running apps (orb, header back, Android back); shell screens move to the native stack; the host edge strip is a post-v1 spike, not adopted | `01` §2.5, §9.3, §14, §15.1, §15.2; `03` Back control, Screen; `05` M3, M13, M24; `06` §3, §8 |
| 3 | MAJOR | The orb covers the bottom-trailing corner; M28 | ACCEPT | One spec, opaque 44 pt, draggable between two corners inside `chromeInsetBottom`, hidden on the host's keyboard signal; M28 deleted. No app-to-host frame: `Modal` pads by the inset instead | `01` §14; `03` Orb, Modal; `05` M16, M23; `#s-app-timer`, `#s-gallery-modal` |
| 4 | MAJOR | `surface` equals `raised`; groups in sheets lose their edge | ACCEPT | New roles `sheet`, `sheet-group`, `thumb`, no new values | `01` §3.1, §7; `03` Sheet, Grouped list, SegmentedControl; `#s-plan`, `#s-consent`, `#s-whim-sheet` |
| 5 | MAJOR | `text-3` and the glow carry content | ACCEPT | `text-3` is disabled only; placeholders and waiting steps use `text-2`; state marks use `ember` | `01` §3.1, §3.2; `03` Text field, Step list; `#s-making` |
| 6 | MAJOR | Tint marks vanish against tracks | ACCEPT | The light value passes 4.56:1 on `fill`, so it is the mark colour and no `tint-mark` token is needed; dark value in dark mode; on-tint checks and knobs | `01` §3.4; `03` Switch, Checkbox, Slider, ProgressBar, Badge |
| 7 | MAJOR | Dynamic Type has no mechanism in apps | ACCEPT | `fontScale` and four more fields on the theme init frame, applied at next open; `maximum-scale=1` removed; accessibility-size layouts | `01` §3.5, §4.3, §15.2; `02` Home; `03` Part 2 |
| 8 | MAJOR | New frames and reversals missing from §15 | ACCEPT | §15 lists every changed and kept decision and every surface change; five Phase B frames withdrawn | `01` §15 |
| 9 | MAJOR | "I" means Whim and the person | ACCEPT | "Decide for me"; controls speak as the person, Whim's "I" only in prose; copy lint in C2 | `01` §12.1, §12.2; `03` Chip; `06` §1 |
| 10 | MAJOR | Plan checked with two-word answers | ACCEPT | Options over 20 characters become rows; prompt caps at 40; answered questions collapse; "Decide for me" exclusive | `02` Plan; `03` Question row; `06` §1; `#s-plan` |
| 11 | MAJOR | 147 icons against old Lucide names | ACCEPT | Alias map, deterministic fallback, invalid-icon eval metric | `04` Fallbacks, Glyph set; `03` Icon |
| 12 | MAJOR | List motion trusts generated keys | ACCEPT | `<List items keyBy renderItem>` animates; children-style `List` is static; bad keys switch motion off | `03` List; `05` M24; `02` Style gallery |
| 13 | MAJOR | The gallery teaches the wrong habits | PARTIAL | The owner keeps it in few-shot, so it becomes an idiomatic worked example; exemplars added; nav example rewritten; `Text color` narrowed | `01` §13; `02` Style gallery; `03` Text; `#s-gallery-type`, `#s-gallery-controls`, `#s-gallery-surfaces`, `#s-gallery-modal` |
| 14 | MAJOR | Tiles blur at 30 apps | PARTIAL | Host assignment, farthest-tint copies and "Customize tile" in v1; two-line labels instead of a `shortName` field | `01` §3.4; `04` Fallbacks, Tile anatomy; `#s-home`, `#s-home-states` |
| 15 | MAJOR | The wisp reads as kitsch | ACCEPT | The eyeless ember: one flame shape, three honest states, four sizes, a silhouette test | `01` §8.2; `03` Ember; `05` M10, M22; `#s-making`, `#s-failure` |
| 16 | MAJOR | The shell is iOS Settings; Whim's ideas are body-size | PARTIAL | Both signatures adopted (quoted words as hero, ember as ambient light); no live preview on Ready, since it would run the app before it is opened | `01` §4.3, §8.2; `02` Plan, Making, Ready, History; `#s-ready` |
| 17 | MAJOR | Opening floods dark mode with the tint | ACCEPT | A `bg` container grows; the tint stays a tile-sized plate | `05` M2; `02` Opening; `01` §3.6; `#s-app-opening` |
| 18 | MAJOR | Motion specs that can't run | ACCEPT | `linear()` gated with a cubic-bezier fallback; rAF springs for retargetable motion; UI-thread width, height and radius; rule 5 restated; one warm WebView in a pool | `01` §9.1, §9.3; `05` rules, M2, SDK note |
| 19 | MAJOR | Making hides Stop and has no retry state | ACCEPT | Stop on the page and the ghost tile; repair row; "Usually 1–2 min"; toast or orb dot; one exit | `02` Making; `06` §1; `#s-making`, `#s-making-queued` |
| 20 | MAJOR | The crash screen traps; Discard crowds the close X | ACCEPT | Orb kept plus "Back to your apps"; error text attached; Discard in the body; History's "Report" text button | `02` Crash, Didn't work, History; `06` §1, §3, §4; `#s-app-error`, `#s-failure`, `#s-history` |
| 21 | MINOR | The documents disagree | ACCEPT | One scale each (ember 24/48/96/128, tiles 24/40/64/96), buttons 52, toasts 4/6 s, SDK `caption` 13, OS-only Reduce Motion, audit pointer fixed | `01` §4.2, §8.2, §9.6; `03`; `04` Tile anatomy; `00` §9 |
| 22 | MINOR | Gestures commit by position | ACCEPT | Commit when the projected end passes the threshold and the velocity doesn't point back; lab aligned | `01` §9.3; `03` Sheet; `05` rule 8, M11 |
| 23 | MINOR | In-app haptics arrive late | PARTIAL | No fast path in v1: SDK controls no longer emit haptics, so only gated cues remain; their latency is measured on device | `01` §10, §15.2 |
| 24 | MINOR | Small targets with no hit-slop in the DOM | ACCEPT | SDK controls reach 44/48 with padding; small shell buttons get full targets | `01` §5.2; `03` Button, Part 2, Stepper, SegmentedControl, Checkbox |
| 25 | MINOR | Undo times out for screen readers; delete could be undoable | ACCEPT | Toasts pause under a screen reader; Undo reachable from History; delete is soft with a 10 s Undo | `03` Toast, Confirm sheet; `06` §4, §5; `#s-delete-confirm`, `#s-history-undo` |
| 26 | MINOR | Closing the making sheet drops typed work | ACCEPT | Closing keeps the draft in the composer and the plan edits | `06` §1; `03` Sheet, Composer bar; `#s-describe` |
| 27 | MINOR | Consent's second act is vague | ACCEPT | "Agree to send descriptions", unticked box, language row in the body, Terms link outside the hit area | `02` First run; `06` §6; `#s-consent` |
| 28 | MINOR | Home order, Settings labels, missed toast | ACCEPT | Old attempts collapse into one tile; "Review what's sent"; Language row; orb dot and Whim-sheet row until reload | `02` Home, Settings, Whim sheet; `06` §2, §5, §7; `#s-home-states`, `#s-settings`, `#s-whim-sheet` |
| 29 | MINOR | Dark-mode tiles keep their light fills | ACCEPT | Deep light-value plate with a rim (≥ 3.53:1); Increase Contrast outlines in `border` | `01` §3.4, §7; `04` Tile anatomy, Accessibility |
| 30 | MINOR | The native work is bigger than listed | ACCEPT | Native work listed and phased | `01` §15.3, §15.4 |
| 31 | NIT | Mockup craft | ACCEPT | Menu shows the full name and clears the first row; concentric ring; badge 18, dot 8; glow tokens; rail stops at v1; versions agree; "Use this version"; ink caret; one-line helper; plan fade; M16 filled; middle truncation | `01` §3.6, §12.2; `02`; `03` Context menu, Text field; `04` States; `05` M16; mockup pass |
| 32 | NIT | States the mockups don't show | PARTIAL | States added to the mockups; the prototype gains back, close, failure and the opening morph, not every moment | mockup pass |
| 33 | NIT | Runtime-page basics | ACCEPT | `user-select` on controls only, tap highlight, overscroll, `touch-action`, `color-scheme`, local-midnight dates | `03` Part 2, Screen, Modal, Slider, DateInput; `01` §15.2 |

Both BLOCKERs are resolved: finding 1 in full, finding 2 as a partial that keeps #67 over running apps and
writes the amendment for shell screens. The critic's top 10 map as follows:

1. Status shape, marks, re-spaced tints (1, 6): `01` §3.3–3.4; the light value replaces a `tint-mark` token.
2. #67 amendment and native stack (2): `01` §15.1; the host close swipe is a post-v1 spike in §15.2.
3. Orb and crash exit (3, 20): `01` §14, `03` Orb, `05` M16; the inset replaces SDK-reported sheets, and the
   host's keyboard signal replaces SDK-reported focus; `02` crash screen.
4. Surfaces and faint text (4, 5): `01` §3.1–3.2 with `sheet`, `sheet-group`, `thumb`.
5. `fontScale` and accessibility layouts (7): `01` §3.5, §4.3, §15.2 items 1–2.
6. Every frame and reversal in §15 (8): `01` §15, with each surface's authority and forgery consequence; cue
   haptics capped at 10/s, burst 3.
7. Pronouns, real-length answers, Stop and repair (9, 10, 19): `01` §12.1; `03` Question row; `02` Making.
8. Generator fit (11, 12, 13): `04` Fallbacks; `03` List and `Text`; the gallery stays in few-shot as an
   idiomatic example, per the owner.
9. Tile assignment (14): `01` §3.4; `04`; two-line labels instead of `shortName`.
10. Ember, signatures, `bg` morph, `linear()` (15–18): `01` §8.2, §4.3; `05` M2 and the SDK note.

Counts: 33 findings. ACCEPT 27, PARTIAL 6, REJECT 0.
