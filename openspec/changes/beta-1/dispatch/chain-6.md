# chain-6 dispatch block: app-keyboard-shell (tasks 6.1–6.3)

Tasks 6.1–6.3 verbatim from tasks.md (the dispatch prompt quotes them).

Read (only these):
- `specs/app-launcher/spec.md` §"Text input never hides the content or action it belongs to" (3 scenarios).
- `design.md` §D3 (the host part; the loader part is chain-7's).
- `research.md` §"Current behavior", the #49/#50 bullet, and §"Relevant files", the ComposeStep/PlanStep/
  SheetModal/AndroidManifest bullet.

Decisions made for the implementer:
1. **React Native built-ins only**, no new dependency (D3; Reanimated isn't installed). One shared wrapper
   component provides:
   - an inset-adjusting ScrollView (`automaticallyAdjustKeyboardInsets` on iOS);
   - `keyboardDismissMode` `interactive` on iOS and `on-drag` on Android;
   - `keyboardShouldPersistTaps="handled"`;
   - a footer slot for the primary action, inside `KeyboardAvoidingView` with iOS `padding`. Android keeps
     `adjustResize` (`AndroidManifest.xml:23`), so no KAV behaviour there;
   - tap on empty space → `Keyboard.dismiss()`, without swallowing scroll gestures or taps on controls.
   Multiline fields on iOS get an `InputAccessoryView` "Done" that dismisses without submitting.
2. **Pure logic in a non-RN sibling** (e.g. the per-platform prop table, and the "does this screen need the
   footer" decision), tested in a Node suite. The component itself stays thin. Node suites can't import RN
   components.
3. **Compose (6.2):** the wrapper, Continue pinned in the footer, no `autoFocus` (the suggestions are visible on
   open), and Done on the description field.
4. **Every TextInput screen (6.3).** Grep `src/host/launcher` for every `TextInput` and adopt the wrapper on each
   screen or sheet. At least: plan editing, "Change it", the report sheet, the settings/server fields, and the
   clarify "Other" field from chain-4 (the dispatcher fills in its component and file from chain-4's report).
   List every one in the report with file:line. `SheetModal`'s `KeyboardAvoidingView` is folded into the
   wrapper or kept as the sheet's only avoidance, never doubled with the wrapper's.
5. **Verification on devices** (iOS simulator + Android emulator, every input screen) is the orchestrator's task
   10.4, so don't try to build native here. The report says which screens changed and what to check on each.
6. `LauncherRoot.tsx` and the step screens were edited by chains 4 and 5 (merged). Keep your edits to the
   keyboard wiring.

Gate: `./scripts/gate.sh` to FAST GATE PASSED. Typecheck the launcher files and tests you touch with a scratch
tsconfig (#79). End the report with HARNESS FEEDBACK (template in docs/harness-feedback/README.md).
