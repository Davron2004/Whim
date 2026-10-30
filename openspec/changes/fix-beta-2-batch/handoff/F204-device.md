# F204 device verdict (runner)
Device: clone "whim-f204" (of iPhone 17 D9A1CB1F), iOS 27.0, deleted after. Build tip 5083db92.
Build: pod install + xcodebuild Release iphonesimulator via capped-run.sh (log scratchpad/verdicts/F204-ios-build.log) EXIT 0. ios/Podfile.lock changed by pod install, restored with git checkout.
Driver: maestro 0.. (tap composer "Make an app…" on clearState launch). Nothing generated.
Evidence dir: /Users/davrondjabborov/Work/other/Whim-evidence/fix-beta-2-batch/F204/
- ios-en-light.png: lead, then Language row (fully visible, "Continuer en français" value), then first summary row title + body, "What stays on your phone" peeking above pinned footer (terms row, Agree, Not now). Gaps lead->Language and Language->summary visually equal. No overlap.
- ios-en-dark.png: identical layout, correct dark tokens.
- ios-fr-light.png / ios-fr-dark.png (via the in-app Language row): title wraps to 2 lines, Langue row + "Ce qui est envoyé, et qui le reçoit" first summary row both visible without scrolling; footer pinned (terms row wraps 2 lines), no truncation. Language switch re-renders all strings.
- ios-en-axxxl.png, -s1/-s2/-s3: largest accessibility size; scroll region is small (footer takes ~half) but sheet scrolls cleanly, Language row stacks label over value, nothing clipped (content fades under header/footer edges as designed). Terms row/Agree wrap, still fully shown.
Not done: BEFORE screenshot (not requested to rebuild base), Android emulator-5560 pass (skipped, time); French at largest size not captured.
VERDICT: PASS
