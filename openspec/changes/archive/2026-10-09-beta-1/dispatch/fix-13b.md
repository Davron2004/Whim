# fix-13b: reveal the final plan editor after the iOS keyboard settles

This is the iOS portion of the pending fix-13 from the September 26 handoff. It closes keyboard acceptance R10 under task 10.4.

1. Use the recorded ios-3 reproduction and the dedicated reproduction specialist's new evidence before implementing: the last row opens and auto-focuses, but its full editor remains below the viewport and keyboard until manually scrolled. The plan row is already the reveal target; investigate the timing and scroll clamping instead of adding a second keyboard avoidance wrapper.
2. Ensure the complete focused row (field, Save and Cancel) is revealed after keyboard padding and viewport/content layout settle. It must work on first focus, while typing and after refocus, without manual scrolling. Done dismisses while retaining unsaved text; Cancel and Save work with the keyboard open. Preserve Compose, Clarify Other, report and Settings behavior, and Android dismissal.
3. Extend the existing rendered geometry test with a sequence that reproduces focus before final keyboard/content layout and fails on the current implementation. Test observable scroll/visible bounds, not source text or timer literals. Preserve cleanup and avoid an unbounded reveal/layout loop.
4. The interactive-drag hang is a separate unconfirmed finding. Keep the existing dismiss mode until the dedicated specialist confirms it using normal Simulator GUI input. If confirmed, report the cause and proposed change to the dispatcher before expanding this chain. Do not change dismissal merely to make XCTest happy.
5. Run the relevant launcher suite and fast gate, commit, and report. The dispatcher will build and independently verify the integrated iOS app.

Scope: `src/host/launcher/KeyboardShell.tsx`, `keyboard-shell.ts` only if the pure contract needs a change, `PlanStep.tsx` only if needed, and `test/keyboard-shell-ui.suite.tsx`. No copy, Home, ConfirmSheet, shared test helper, runtime, storage, native config or release-script changes. Do not operate devices while the reproduction specialist owns the simulator.

Acceptance: the last row's full editor clears the keyboard and pinned Build control on first focus, typing and refocus; Done/Cancel/Save behave as above; existing keyboard screens and Android behavior regressions stay green.
