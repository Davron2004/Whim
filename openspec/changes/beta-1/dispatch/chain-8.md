# chain-8 dispatch block: app-diagnostics-and-polish (tasks 8.1–8.4)

Read: `specs/device-diagnostics/spec.md` (whole), `specs/app-launcher/spec.md` §"Orb and tiles render cleanly on
both platforms" and §"Numbers in English copy use an English locale", `design.md` §D7, §D14, and `research.md`
§"Current behavior" (the #48/#52, #89, #101 and #105 bullets).

Decisions made for the implementer:
1. **8.1:** `thrownFields` reduces every frame's location to `basename:line:column` on every platform. Test with
   a real iOS-shaped stack (`…/Bundle/Application/<UUID>/Whim.app/main.jsbundle:1:234567`) and an Android one.
   "Still symbolicates" means the trimmed frames resolve through the build's source map to the same source lines
   as the untrimmed ones. Use the repo's existing symbolication path (find it; the source-map round-trip in
   `npm run build` is a hint), and don't invent one.
2. **8.2 (#105):** the scrim becomes a status-bar-translucent full-window layer (`Modal` with
   `statusBarTranslucent`, or an equivalent that really covers the status bar on Android). Remove the Android
   `elevation`, which draws the grey disc; `shadow*` is iOS-only (see memory `rn-style-platform-gaps`). Say what
   the orchestrator should look at on each platform in 10.4.
3. **8.3:** #48: check whether the watermark still clips (reason from `app-tile.tsx`'s layout math and the
   existing comments; the orchestrator confirms on device). Fix only if it does. Give examples distinct declared
   tile colours, leaving `appColor`/`hashName` untouched (they recolour every app). The test checks the colours
   are pairwise distinct, against the real example list.
4. **8.4:** `toLocaleString('en-CA')` for counts in English copy. `run-signals.suite.ts` must pass under
   `LANG=fr_CA.UTF-8` and should fail under it on the old code (red-check).
5. `Orb.tsx` was last touched by chain-7 and `copy.ts` by chains 4/6. Keep the edits to these fixes.

Gate: `./scripts/gate.sh` to FAST GATE PASSED. End with HARNESS FEEDBACK (docs/harness-feedback/README.md).
