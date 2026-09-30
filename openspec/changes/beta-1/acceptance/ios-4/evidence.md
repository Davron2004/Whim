# iOS native acceptance, build 391705

Device: `469C2821-24D0-4FF4-B72D-DCDB9184048D` (Whim-beta1-2156, iOS 27.0). I tested the installed Release app only. No source, build, or simulator-install changes were made during this pass.

## Passed

- The production prompt reached Clarify once. It rendered two select-one groups, and their chosen values carried through to a four-card plan. `02-after-submit-hierarchy.json` records the actual controls; `06-plan.png` shows the resulting plan.
- The fourth card (`WHAT IT REMEMBERS`) autofocuses above the keyboard. In `08-last-row-autofocus-hierarchy.json`, the live scroll viewport is `[0,103][402,409]`, the editable field is `[40,266][362,350]`, Cancel is `[273,362][315,375]`, Save is `[331,362][362,375]`, and Build it is `[22,426][380,478]`. `08-last-row-autofocus.png` shows the full editing row, both actions, Build it, and Done above the keyboard.
- Typing stayed visible (`09-last-row-typed.png`). Done dismissed the keyboard without losing the draft (`10-done-retains-draft.png`), and refocusing restored the keyboard and draft (`11-last-row-refocus.png`). Cancel while the keyboard was up discarded a deliberately unsaved suffix. Save committed the next suffix while the keyboard was up; `13-save-by-bounds.png` shows the card closed with the saved text. The first accessibility-text Save tap left the editor open, but a direct tap inside the hierarchy-reported Save bounds committed it. That looks like a Maestro selector quirk, not a missed control.
- One authorized build completed. `14-build-result.png` shows Water Tracker ready, and `19-open-water-tracker.png` shows the generated app running.
- `15-report-sheet.png` and `15-report-sheet-hierarchy.json` show the report sheet as a full-window modal with distinct choice chips, note field, Send report, and Cancel controls. `26-report-keyboard.png` shows its note field, Send report, Cancel, and Done above the keyboard. I canceled without sending.
- Home long-press actions are exposed separately in `17-home-actions-hierarchy.json`, and the action sheet is visible in `17-home-actions.png`. History works from Home (`18-history.png`) and Versions works from the running-app menu (`20-orb-menu.png`). The menu's Home action returned to the app grid (`22-orb-home.png`). Delete opened its confirmation and Cancel kept Water Tracker (`25-delete-confirmation.png`).
- Settings uses a 22-point content inset: Back begins at x=22 and the cards span x=22 to x=380 in `23-settings-hierarchy.json`. `23-settings.png` shows the error-details helper text, and Back returned to Home.

## Coverage gaps

- This production Clarify response did not contain an Other choice, so Other-entry behavior was not exercised. I did not make another request solely to chase a different response.
- I did not create a limit response or a failed generation. The app therefore had no Try again primary to activate. The one permitted generation succeeded.
- Normal interactive keyboard dragging remains unverified. Maestro gestures were not used as evidence for that human interaction.

## Runner notes

Completed Maestro flows finished without the Android run's `NoSuchFileException`. Two old text selectors failed before the checks: the generated plan wording differed from the saved baseline, and the Home action sheet has no Report this app item. The retargeted observable checks completed successfully.
