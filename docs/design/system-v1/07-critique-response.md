# Critique response

The decision record for the critique of 2026-10-09
(`Whim-evidence/design-critique-2026-10-09/CRITIQUE.md`, reviewed at `adf90fa7`): 33 findings, each with its
verdict and the section of [`../system.md`](../system.md) that now answers it. The working docs the C1 pass
edited (`00`–`06`) were folded into `system.md` and removed; they are in git history before decision #75.
`#s-…` ids open a screen in [`../mockups/index.html`](../mockups/index.html). Nothing was rejected. Six findings
are partial: the problem is accepted and fixed, but not with the critique's exact remedy.

| # | Severity | Finding | Verdict | Reason | Now in `system.md` |
|---|---|---|---|---|---|
| 1 | BLOCKER | Three tints are the status colours | ACCEPT | Ten cool tints, each ≥ 20.3 ΔE2000 from every status form and ember (≥ 10 under CVD); status gets a shape: danger never fills, badges carry icons | §2.3, §2.4, §7.1 Button, §7.2 Badge |
| 2 | BLOCKER | Back over a running app reverses #67 silently | PARTIAL | #67 kept over running apps (orb, header back, Android back); shell screens move to the native stack; the host edge strip is a post-v1 spike, not adopted | §9, §4.4 M13, §7.2 Screen; decision #75 |
| 3 | MAJOR | The orb covers the bottom-trailing corner; M28 | ACCEPT | One spec, opaque 44 pt, draggable between two corners inside `chromeInsetBottom`, hidden on the host's keyboard signal; M28 deleted. No app-to-host frame: `Modal` pads by the inset instead | §7.1 Orb, §4.4 M16 and M23, §7.2 Modal |
| 4 | MAJOR | `surface` equals `raised`; groups in sheets lose their edge | ACCEPT | New roles `sheet`, `sheet-group`, `thumb`, no new values | §2.1, §2.10, §7.1 Sheet and Grouped list |
| 5 | MAJOR | `text-3` and the glow carry content | ACCEPT | `text-3` is disabled only; placeholders and waiting steps use `text-2`; state marks use `ember` | §2.1, §7.1 Text field and Step list |
| 6 | MAJOR | Tint marks vanish against tracks | ACCEPT | The light value passes 4.56:1 on `fill`, so it is the mark colour and no `tint-mark` token is needed; dark value in dark mode; on-tint checks and knobs | §2.4, §7.2 Switch, Checkbox, Slider, ProgressBar, Badge |
| 7 | MAJOR | Dynamic Type has no mechanism in apps | ACCEPT | `fontScale` and four more fields on the theme init frame, applied at next open; `maximum-scale=1` removed; accessibility-size layouts | §2.5, §2.7, §6 |
| 8 | MAJOR | New frames and reversals missing from §15 | ACCEPT | §15 lists every changed and kept decision and every surface change; five Phase B frames withdrawn | decision #75 |
| 9 | MAJOR | "I" means Whim and the person | ACCEPT | "Decide for me"; controls speak as the person, Whim's "I" only in prose; copy lint in C2 | §8 |
| 10 | MAJOR | Plan checked with two-word answers | ACCEPT | Options over 20 characters become rows; prompt caps at 40; answered questions collapse; "Decide for me" exclusive | §7.1 Question row, §9 Plan |
| 11 | MAJOR | 147 icons against old Lucide names | ACCEPT | Alias map, deterministic fallback, invalid-icon eval metric | §3.1 |
| 12 | MAJOR | List motion trusts generated keys | ACCEPT | `<List items keyBy renderItem>` animates; children-style `List` is static; bad keys switch motion off | §7.2 List, §4.4 M24 |
| 13 | MAJOR | The gallery teaches the wrong habits | PARTIAL | The owner keeps it in few-shot, so it becomes an idiomatic worked example; exemplars added; nav example rewritten; `Text color` narrowed | §7.2 style gallery |
| 14 | MAJOR | Tiles blur at 30 apps | PARTIAL | Host assignment, farthest-tint copies and "Customize tile" in v1; two-line labels instead of a `shortName` field | §2.4, §3.2 |
| 15 | MAJOR | The wisp reads as kitsch | ACCEPT | The eyeless ember: one flame shape, three honest states, four sizes, a silhouette test | §3.3 |
| 16 | MAJOR | The shell is iOS Settings; Whim's ideas are body-size | PARTIAL | Both signatures adopted (quoted words as hero, ember as ambient light); no live preview on Ready, since it would run the app before it is opened | §2.7, §3.3, §9 Ready |
| 17 | MAJOR | Opening floods dark mode with the tint | ACCEPT | A `bg` container grows; the tint stays a tile-sized plate | §2.6, §4.4 M2 |
| 18 | MAJOR | Motion specs that can't run | ACCEPT | `linear()` gated with a cubic-bezier fallback; rAF springs for retargetable motion; UI-thread width, height and radius; rule 5 restated; one warm WebView in a pool | §4.1, §4.3, §4.4 M2 |
| 19 | MAJOR | Making hides Stop and has no retry state | ACCEPT | Stop on the page and the ghost tile; repair row; "Usually 1–2 min"; toast or orb dot; one exit | §8, §9 Making |
| 20 | MAJOR | The crash screen traps; Discard crowds the close X | ACCEPT | Orb kept plus "Back to your apps"; error text attached; Discard in the body; History's "Report" text button | §9 App crashed, Didn't work, History |
| 21 | MINOR | The documents disagree | ACCEPT | One scale each (ember 24/48/96/128, tiles 24/40/64/96), buttons 52, toasts 4/6 s, SDK `caption` 13, OS-only Reduce Motion, audit pointer fixed | §2.8, §3.2, §3.3, §4.5, §7.1 Toast, §7.2 Text |
| 22 | MINOR | Gestures commit by position | ACCEPT | Commit when the projected end passes the threshold and the velocity doesn't point back; lab aligned | §4.3 rule 6 |
| 23 | MINOR | In-app haptics arrive late | PARTIAL | No fast path in v1: SDK controls no longer emit haptics, so only gated cues remain; their latency is measured on device | §5 |
| 24 | MINOR | Small targets with no hit-slop in the DOM | ACCEPT | SDK controls reach 44/48 with padding; small shell buttons get full targets | §2.8, §7.2 |
| 25 | MINOR | Undo times out for screen readers; delete could be undoable | ACCEPT | Toasts pause under a screen reader; Undo reachable from History; delete is soft with a 10 s Undo | §7.1 Toast and Confirm sheet, §9 Delete |
| 26 | MINOR | Closing the making sheet drops typed work | ACCEPT | Closing keeps the draft in the composer and the plan edits | §7.1 Sheet, §9 |
| 27 | MINOR | Consent's second act is vague | ACCEPT | "Agree to send descriptions", unticked box, language row in the body, Terms link outside the hit area | §9 First run |
| 28 | MINOR | Home order, Settings labels, missed toast | ACCEPT | Old attempts collapse into one tile; "Review what's sent"; Language row; orb dot and Whim-sheet row until reload | §9 Your apps, Settings, Whim sheet |
| 29 | MINOR | Dark-mode tiles keep their light fills | ACCEPT | Deep light-value plate with a rim (≥ 3.53:1); Increase Contrast outlines in `border` | §2.4, §3.2 |
| 30 | MINOR | The native work is bigger than listed | ACCEPT | Native work listed and phased | decision #75; `openspec/changes/design-system-v1` chains `native-deps`, `haptics`, `platform-theming` |
| 31 | NIT | Mockup craft | ACCEPT | Menu shows the full name and clears the first row; concentric ring; badge 18, dot 8; glow tokens; rail stops at v1; versions agree; "Use this version"; ink caret; one-line helper; plan fade; M16 filled; middle truncation | mockups; §7.1 Context menu and Text field |
| 32 | NIT | States the mockups don't show | PARTIAL | States added to the mockups; the prototype gains back, close, failure and the opening morph, not every moment | mockups |
| 33 | NIT | Runtime-page basics | ACCEPT | `user-select` on controls only, tap highlight, overscroll, `touch-action`, `color-scheme`, local-midnight dates | §7.2, §6 |

Both BLOCKERs are resolved: finding 1 in full, finding 2 as a partial that keeps #67 over running apps and
moves shell screens to the native stack.

Counts: 33 findings. ACCEPT 27, PARTIAL 6, REJECT 0.
