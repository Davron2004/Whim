# iOS reproduction, 2026-09-29

Dedicated device: `469C2821-24D0-4FF4-B72D-DCDB9184048D` (Whim-beta1-2156, iOS 27.0). Existing Release build `com.anycognition.whim` 1.0.0 (386656). It launched with four installed apps, including Water Goal. Other devices were untouched. The old 09:41 status-bar override was cleared.

Local servers on ports 8787 and 8790 were stopped. This release build has no Advanced server routing. The parent authorized the necessary production calls. Prompt submitted at about 20:15 EDT: "A water tracker with a daily goal of 8 glasses, a button to add a glass, today's progress, and a saved daily history." Clarify answers: "Fixed at 8 glasses" and "Last 7 days". One clarify and one plan request completed; no generation was started.

Run flows with:

```sh
maestro --udid 469C2821-24D0-4FF4-B72D-DCDB9184048D test /Users/davrondjabborov/Work/other/Whim/openspec/changes/beta-1/acceptance/ios-repro-resume/FLOW.yaml
```

Order: `compose.yaml`, `clarify.yaml`, `continue.yaml`, `plan.yaml`, `edit-row4.yaml`. The first Continue tap immediately after text entry did not advance; the settled second tap did. `04-after-clarify` is therefore still Compose, despite its provisional filename. The following screenshot and hierarchy confirm the actual clarify screen.

Maestro interaction and hierarchy commands must be serial on this device. The first test runner crashed during bootstrap while a hierarchy command was running; a serial retry worked. Whim was idle at 0% CPU during the tool failure.

## Normal drag investigation

Unverified. No normal drag was delivered. Xcode 27 has no Simulator.app under either `Contents/Developer/Applications` or `Contents/Applications`, and bundle id `com.apple.iphonesimulator` is not registered. The installed replacement is `Contents/Applications/DeviceHub.app`, bundle id `com.apple.dt.Devices`. `@oai/sky` via node_repl returned `Computer Use server error -10005: timeoutReached` for its path, display name and bundle id. This does not confirm or disprove the older XCTest drag wedge. Preserve interactive dismissal pending normal interaction evidence.

## Plan row 4: reproduced

`08-edit-settled.png` and `08-edit-settled-hierarchy.json` show the settled state with a normal keyboard. The editor is completely hidden. On the 402 × 874pt screen:

| Element | Bounds (pt) |
|---|---|
| Scroll viewport | y103–409 |
| Row 4 label | x40–362, y541–554 |
| Row 4 editor | x40–362, y562–625 |
| Cancel / Save | y637–650 |
| Build it | y426–478 |
| Done | y517–530 |
| Keyboard inputView | y546–874 |

The editor starts 153pt below the viewport edge; all 63pt of its height lie under the keyboard. The scroll content keeps the same offset after autofocus. The first keyboard focus showed iOS's QuickPath introduction; `dismiss-keyboard-tip.yaml` dismissed it. The settled normal keyboard screenshot confirms that the introduction was not the cause.

Typing " Keep entries for 14 days." also leaves the field hidden (`09-edit-typed.png` and hierarchy). Its bounds become y549–633, with Cancel/Save at y645–658. The viewport still ends at y409; the full 84pt field remains under the keyboard's y546 top. Its contents changed, proving it received input despite being invisible.

Done dismisses the keyboard and preserves the unsaved draft (`10-after-done.png`). Tapping the same draft refocuses it; `11-refocus.png` records the resulting screen. The draft was left unsaved for follow-up. No app build was started, and no product files or Git state were changed.

Refocus reproduces the same complete concealment; see `11-refocus.png` and `11-refocus-hierarchy.json`. This report was edited using the unslop skill. Simulator ownership is returned to the orchestrator with the plan editor focused and its unsaved draft intact.
