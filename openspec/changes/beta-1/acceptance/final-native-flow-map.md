# Beta-1 native flow map
## Boundary and source pin
Use this after the final gate names a candidate. Record `PRODUCT_SOURCE_SHA`, build
number, APK/app hash, device ID, and evidence directory first. The 391705 receipts
name `a1586b87`, not a later product artifact; rebuild if a product input changed.
There is no checked-in `.maestro/`. The 33 iOS YAML fragments (26 `ios-4`, 7
`ios-repro-resume`) preserve Water Tracker paths, not a complete new acceptance run;
the upgrade-check YAML is 10.5 only. Android reuses the `emulator-5560`-targeted
`acceptance/android-final-392403/post-ui.py` hierarchy/capture helper, copied byte-for-byte
from android-4. Build 392403 is built and preserved from approved product source `c76191d34343510c5c5af748132c5b2a650067ee` (artifact build HEAD `a58403876ffb62977f414e87bba8b4093f338eeb`). Full gate, independent review, all three required CI checks and Sonar with zero open issues passed; native execution remains pending.
Candidate iOS material is in `ios-debug-final-392403/flows` (20 files) and
`ios-release-final-392403/flows` (9 files). Both syntax checks passed; native execution
and Maestro runtime validation remain pending. The older fragments below are references.
Before Maestro, require two clear scans 60 seconds apart from
`/tmp/whim-beta1-maestro-isolation.md`, one client per owned device, and no parallel
hierarchy call; `fix-8.md` records that it restarts the driver.
## Deterministic stub controls
Start only the current candidate's local server with `WHIM_PIPELINE=stub`. The
stub-only `WHIM_STUB_DELAY_MS=4000` delays each emitted event; the default is 200 ms
and production refuses both it and the stub selector. For the cap-one line, use:
```sh
env -u OPENROUTER_API_KEY NODE_ENV=development WHIM_PIPELINE=stub WHIM_SERVER_HOST=127.0.0.1 \
  WHIM_SERVER_PORT="$QA_PORT" WHIM_DATA_DIR="$QA_DATA" \
  WHIM_MAX_CONCURRENT_GENERATIONS=1 WHIM_STUB_DELAY_MS=4000 \
  node server/dev.mjs
```
Literal stub inputs and their observed routes are:
| Input | Route and expected state |
|---|---|
| ordinary text | Three canned questions: Q1 select-one, Q2 select-many, Q3 select-one plus `Or type your own answer`; five base plan rows plus answered rows; Hello App result. |
| `[[noclarify]]` | Clarify returns zero questions. |
| `[[limit]]` | Limit screen: `Whim can’t build this as asked`, weather reason, `Build a packing list you fill in yourself instead`, and `Change my idea`. |
| `[[fail]]` | Ordinary terminal failure, distinct from a compatibility fallback. |
| `[[future:skip]]` | Emits an unknown compatible frame, drops it, then completes. |
| `[[future:fail]]` | Failure with `This build needs a newer version of Whim to finish.` and a pending-record Retry (`Try again`). |
| `[[future:update]]` | Update path with `Update Whim to see this build through.`; no installed app. |
The marker strings are read only by the stub (`server/src/stub-markers.ts`,
`routes/clarify.ts`, `pipeline.ts`). The real server does not treat them specially.
The final receipt must retain captures for ordinary failure, both `limit` exits,
future skip completion, future-fail notice plus Try again destination, and future-update
notice with no installed app; the 391705 evidence does not replace those recaptures.
## Reusable iOS Debug flows
Debug is the only iOS build that accepts Settings -> Advanced routing. Build with
`FORCE_BUNDLING=1`, point it at `http://127.0.0.1:$QA_PORT`, and use a new simulator.
Release deliberately ignores that override (`WhimAppInfoModule.mm`); keep its pass on
production. A reusable serial invocation is:
```sh
maestro --udid "$IOS_DEBUG_UDID" test --debug-output "$RUN_ROOT/maestro/$NAME" -e "EVIDENCE_DIR=$REPO/openspec/changes/beta-1/acceptance/ios-debug-final-392403" -e "CASE=$NAME" "$FLOW"
```
The existing production keyboard path is serial: `ios-repro-resume/compose.yaml`,
`clarify.yaml`, `continue.yaml`, `plan.yaml`, then `ios-4/keyboard-last-row.yaml`.
For candidate evidence, do not run `refocus-row4.yaml` unmodified: it has a hard-coded
`takeScreenshot` destination in the old `ios-repro-resume` folder.
Use this Debug-only flow after the legal flow has completed to exercise Other, an
active select-one pill while its keyboard is up, and the final answered plan row:
```yaml
appId: com.anycognition.whim
---
- tapOn: "Describe an app…"
- inputText: "iOS final keyboard checklist"
- tapOn: "Continue"
- waitForAnimationToEnd
- tapOn: "Or type your own answer"
- inputText: "gypsy jolly queue"
- tapOn: "It stays, ticked"
- waitForAnimationToEnd
- tapOn: "Continue"
- waitForAnimationToEnd
- swipe: { start: "50%, 72%", end: "50%, 35%", duration: 500 }
- tapOn: "What happens when something is done?"
- waitForAnimationToEnd
```
Capture hierarchy and screenshot before the pill tap, after it, and at first plan-row
focus. From that final state, make separate keyboard-up runs for Cancel and Save; record
field, both actions, scroll viewport, Build it, and keyboard bounds. The existing
`ios-4/{cancel-keyboard-up,save-keyboard-up,done-retains-draft,refocus-last-row}.yaml`
show the action sequence but contain Water Tracker-specific text.
For the three fallback paths, use the same fresh Compose -> Continue -> Plan -> Build
sequence with the listed literal input. Capture the terminal before acting. For limit,
run `Build a packing list you fill in yourself instead` and `Change my idea` in separate
fresh attempts; the first must re-enter Clarify and the second Compose. For future fail,
tap `Try again` after the notice and capture the retry's destination. Future skip must
reach the Hello App done state; future update must have no installed app.
## Android reuse and the line
`acceptance/android-4/post-plan.md` is the detailed Android run order. The helper below
derives taps from the current hierarchy, refuses evidence-name overwrites, and writes a
screenshot, XML, and window dump together:
```sh
python3 "$REPO/openspec/changes/beta-1/acceptance/android-final-392403/post-ui.py" show
python3 "$REPO/openspec/changes/beta-1/acceptance/android-final-392403/post-ui.py" capture post-<new-name>
python3 "$REPO/openspec/changes/beta-1/acceptance/android-final-392403/post-ui.py" tap '<exact label>'
python3 "$REPO/openspec/changes/beta-1/acceptance/android-final-392403/post-ui.py" longtap '<exact tile label>'
```
It is only for the fresh, owned `emulator-5560`. First set Android's internal-build
Advanced address to `http://localhost:$QA_PORT` after the matching `adb reverse`.
`post-plan.md` covers Tier-0 legal flow, keyboard, sheets, ordinary stub build, report,
ordinary failure, update ghost, and interruption. It also names the capture prefixes.
For cap + 2 at `WHIM_MAX_CONCURRENT_GENERATIONS=1`, the three builds need distinct
device IDs; a second live build from one ID returns `device_busy`, not a position.
Section 10.4 says “three builds,” and the recorded receipt says “distinct device IDs”; neither requires three literal native devices. Prepare native C through its plan screen,
then run controlled A and B holders with fresh UUIDs from
`/tmp/whim-beta1-line-clients-final.mjs`. Complete the full quiet window before starting
these holders; after `READY_FOR_NATIVE_C`, scan immediately and tap C's Build without
another 60-second delay.
C must first show “You’re in line, 1 build ahead.” (position 2), then “You're next in
line.” (position 1) after A completes, then begin only after B completes. The script
records A running, B queued, and B handoff; C's screenshots/hierarchy and server event
order are the native/FIFO evidence. This proves C's native queue handling, not a native
UI for A or B. It creates no children: its 150-second abort is its own cleanup. If run in
the background, add only its saved `LINE_CLIENT_PID` to the existing owned-PID trap.
```sh
node /tmp/whim-beta1-line-clients-final.mjs --base-url "http://127.0.0.1:$QA_PORT" --build "$BUILD" --platform "$NATIVE_PLATFORM" --app-version "$APP_VERSION" --out "$RUN_ROOT/line-$NATIVE_PLATFORM" --timeout-ms 150000 &
LINE_CLIENT_PID=$!
```
## Cold restart after an ended failure

Task 11.4 needs a restart smoke on the rebuilt candidate. After line holders and other clients
finish, reserve one generation within the device's supported quota. Capture an active ordinary
stub build, stop only the saved Whim QA server PID, and wait up to 90 seconds for a generic
failure to settle. Capture its actions and absence of a report, then go Back and confirm one
matching failed ghost. Terminate and relaunch only the owned native app, reopen that ghost, and
capture the same generic failure without an attached report. Read the actual UI for selectors.

Keep the QA data directory if the server must restart; record its new PID and refuse an occupied
port. Do not stop the app while it is still building, which would test startup interruption.
This is a native ended-failure/cold-restart smoke with writable storage. The controlled Node
tests provide the write-outage and stale-journal proofs. Flow 18 alone observes a saved entry
and cannot claim either fault injection or this full smoke. The detailed preparation is
`/tmp/whim-beta1-native-cold-failure-plan-392403.md`; no result is claimed yet.

## What remains manual or owner-only
`acceptance/section-10-plan.md` still lists every Tier-0 path, cap + 2, limit, and all
three future fallbacks for both platforms. The newer final-candidate sheet only calls out
Android update plus ordinary failure and Debug-iOS future failure; it does not explicitly
re-run future skip. That is a coverage mismatch in the planning records, not proof that
skip can be omitted from the section-10 receipt.
The iOS Release 391705 receipt covers normal Clarify/plan keyboard, one production build,
Home/History/orb/report, and Settings. It lacks Other, limit, failure/Try again, and a
normal interactive keyboard drag. Debug stub runs close the deterministic Other/limit/
fallback gaps but do not replace Release production evidence. Only the owner can provide
the normal finger/Simulator-GUI drag verdict; Maestro/XCTest gestures are not evidence for it.
I did not run a server, native build, device, or Maestro command while preparing this map.
