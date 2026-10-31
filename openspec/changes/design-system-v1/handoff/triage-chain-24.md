# Chain-24 device findings: triage (Opus high reviewer, shift 4b, 2026-10-30)

Inputs: verdicts 24-{a1,a2,a3,a3r,a4,i1,i2,i3}.md on branches device/<id>; a1/a2/a3/i1 ran on 77c3d132, a3r/a4/i2/i3 on 20d7a0f9 (later rechecks supersede).

## FIX-NOW (pre-beta fix piece)
- F1 MED plan row edit doesn't raise the keyboard, API 37 only (a2, a3r; 29/34/iOS fine) — keyboard-shell "Android focuses it at once", §6. KeyboardShell.tsx:743 askForKeyboard, PlanPage.tsx:402.
- F2 MED iOS Home composer Describe opens unfocused once a make has started (i2 3/3) — §9 Describe. KeyboardShell.tsx:796-810 (iOS overlayShown forced true; wait for Sheet's OverlayShownContext).
- F3 MED Android API 34 status-bar icons dark on dark after a live dark flip once an app opened (a4; brief on 37, a1) — §9 Opening, §2.5. LauncherRoot.tsx:474/:3964, MainActivity.kt #189 code.
- F4 MED Settings/Advanced/AI features/Report lack a large title (a1) — §9 Settings largeTitle, §2.8 title1. NativeStack.tsx:58 headerFor + the screens.
- F5 LOW consent icon rows centred on the tall row (a1, a2, i1) — top-align to the title's first line.
- F6 LOW Advanced "Verified" green text without a check — §2.3 status hues never stand alone. AdvancedScreen.tsx:69.
- F7 LOW See why row lacks the danger dot — §9. WhimSheet.tsx.

## SPEC-ALIGN (same piece, docs/specs only)
- Whim sheet → History → Back lands on the app (intended, LauncherRoot.tsx:1557): app-launcher delta (spec.md:456) + system.md §9 Whim sheet.
- Report from the Whim sheet: Back → sheet menu, Close → app: MODIFIED "Closing the sheet sends nothing" in the dsv1 content-reporting delta.
- tasks.md 14.2 tick is wrong (#164): reword to the D7 fallback; launcher-screen-exits delta :53 + "Predictive back on Android" scenario → standard pop.
- First back with the keyboard up only closes the keyboard: launcher-screen-exits clause.
- iOS Done bar above the keyboard is deliberate (KeyboardShell.tsx:778): system.md §6 Keyboard clause.
- Report "What gets sent" row appears once a reason is chosen: system.md §9 Report.

## ACCEPT
200% ring number under the ring (= §6 + §7.2; Android 29/34/37 + iOS); Update-required back ~2 s (swiftshader); blank sheet after
consent (swiftshader, not reproduced); HC halos (platform); Delete no confirm (§9 by design); fixed-size glyphs at 200% (ruling 6);
200% Controls wrap (§7.2); iOS 'loading' open 1.8–1.9 s right after launch (record in verification.md); Link-missing ignores swipe,
WebView form bar, API 29 light keyboard under dark sheet, keyboard behind the back menu (platform/simulator).

## DEFER (issues)
i3 tile tap within ~1.5 s of Back to your apps → onto #224 (re-time with the two-tap verb at 1.0/1.25/1.5 s); API 29 WebView 91
crash → min WebView version decision; AX2 SDK two Buttons in a Row don't stack; SDK Chart bar labels truncate; Home list rows at
200% nearly touch; Making 135% ember entrance frame; Increase Contrast tinted tile plates lack the §6 outline.

## Tick wording (24.1 after F3 recheck; 24.3 after F1/F2 rechecks)
- 24.1 PASS (partial: iOS 27.0 only, no oldest runtime; not seen in dark on iOS: History, Report, Describe, Plan, Making, Whim sheet; API 34 Making page and API 29 dark running app/Whim sheet beyond the gallery not seen; app-crashed seen on API 29 only; Age and screen-error fallback not reached (needs a dev trigger))
- 24.2 PASS (partial: iOS xxxl and AX2 only; 135% empty state not shot; Reduce Motion judged from low-fps strips (Android) and stills (iOS), toast exit and History/Whim-sheet morphs not seen; Increase Contrast on Home, Settings and Surfaces only (iOS); high-contrast text not on Settings sub-screens; AX2 SDK button row deferred (issue))
- 24.3 PASS (partial: Android IME height change checked on API 37 only (emoji IME), not 29/34 (#129); app is portrait-locked, so rotation is not applicable)
- 24.4 PASS (partial: app-crashed exits on API 29 only; iOS edge swipe on Making and consent not tried; first-run consent from the composer not walked on iOS; predictive back is the D7 fallback, arrow only, #164)
- 24.5 PASS (partial: paint-before-first-frame shown by frames, not on one clock; no 'cold' WebView launch produced on either platform; Android timings on swiftshader not comparable to the host table; iOS 'loading' opens 1.8–1.9 s, no baseline)

## Product questions → orchestrator defaults (recorded)
Q1 F4 title treatment: in-content title like History (largeTitle on Settings, title1 on the rest), native header keeps back + the back-menu title, inline title blank (§2.8 as written). Q2 #164: accept the standard pop for beta, amend the scenario, keep #164 open. Q3 min WebView: no gate for beta (deferred issue). Q5 IC tinted plates: outline per §6 (deferred issue).
