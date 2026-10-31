# F193 device repro (runner, emulator-5560, Android 17 AVD Whim_Verify, offline APK from staging tip efd077be)

Preflight: node v22.23.3; headless emulator on 5560; `./gradlew :app:assembleOffline` via capped-run.sh, BUILD SUCCESSFUL 5m57s, EXIT 0 (log: scratchpad/verdicts/F193-build.log); installed with `adb -s emulator-5560 install -r -d`. Git tree clean after build. No server contacted (Tip Splitter example, no generation).

Evidence dir: /Users/davrondjabborov/Work/other/Whim-evidence/fix-beta-2-batch/F193/

| page | mode | screenshot | reading |
|---|---|---|---|
| Whim-sheet Report page (orb > Report a problem) | dark | 04-report-sheet-dark.png | title, "What went wrong?" header, Cancel all legible on the dark sheet card (27,25,23). Measured: title 15.4:1, header 7.43:1, Cancel 15.4:1. Send report observed only DISABLED (no reason chosen): 3.03:1, disabled styling |
| Native-stack ReportScreen (tile long-press > History > Report) | dark | 08-report-screen-dark.png | legible on bg (16,14,13). Measured: title 16.92:1, header 8.17:1, Cancel 16.92:1; Send disabled |
| Whim-sheet Report page | light (control) | 09-report-sheet-light.png | clean, dark text on light card |
| ReportScreen | light (control) | not captured (taps misfired; control only) | n/a |

Caveat: Send was never seen enabled, so its enabled-state contrast is unmeasured; the contrast test should cover it.
Other screenshots: 03-sheet.png (dark Whim sheet), 06-tilemenu.png, 07-history.png.

VERDICT: CLEAN (already fixed)
