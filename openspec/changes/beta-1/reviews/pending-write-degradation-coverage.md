# Chain-10 acceptance matrix

| Required case | Test / observation |
|---|---|
| Fresh shell suppresses old report | `ghosts: a fresh launcher over the same MMKV...`; same MMKV, generic failed+marker, `attemptStarted=false`, `journal=null` |
| False and thrown removal faults; recovered discard | `ghosts: a native false-return...` and `ghosts: a thrown journal removal...` |
| Dangling order after pending-key delete | `ghosts: a pending-order write failure...`; raw key absent, raw order retains id, later Discard clears it |
| Fully unwritable terminal live failure | `ghosts: a fully unwritable terminal settlement...`; HTTP begins, raw building/current failed, live Discard, Back/reopen no report |
| Same-id stale lease and independent id | `pending-builds: opaque leases fence stale equal-time completions...` |
| Legacy marker and cold demotion preservation | `pending-builds: legacy JSON accepts the marker...` and fresh-shell UI coverage |
| Failed Retry setup then recovered Retry | `ghosts: a failed Retry sends no new request until setup recovers and then reuses its id once`: starts with one initial request, drives Retry → consent → Agree under a journal-write fault, observes no additional `/v1/generate`, exact old pending/journal bytes and one failed ghost, clears the fault, then observes exactly one additional request and the same ID building. |
| Cold demotion during a selective write outage | `ghosts: cold recovery retains an unwritable interruption while recovering the other building record`: a fresh `LauncherRoot` over two persisted building records lists both as interrupted; the unwritable raw record remains flagged `building`, its sibling raw record persists interrupted, and opening the retained entry exposes no old report. |
| Native app-link routing for a retained current view | `ghosts: an app link resolves a retained current failure instead of its raw building record`: under fully unwritable terminal writes, the native `openLink(appLinkFor(id))` handler opens a discardable failed screen with no report, then Back leaves exactly one failed ghost. |
| Thrown active-stream failure action identity | `ghosts: a thrown active stream failure keeps its volatile live failure actionable`: a real active generation response body throws after activation while terminal pending/journal writes fail; the live generic failure has Retry and Discard, emits no unhandled rejection, then Back/reopen leaves one failed ghost and no report. |
| Stale same-ID action authorization | `ghosts: a stale same-id stream failure cannot borrow the newer volatile failure actions`: active A is superseded by same-ID retry B, B retains its volatile failure, then delayed A throws. B's Retry and Discard remain unchanged, while Home keeps B's one failed ghost unchanged. |
| Stale same-ID active retry ownership | `ghosts: a stale same-id stream failure keeps the active retry reattachable and cancellable`: A's delayed iterator error arrives while same-ID retry B still streams. B remains reattachable, and Cancel aborts B's request before removing its ghost. |
| Stale same-ID refusal ownership | `ghosts: a stale same-id refusal keeps the active retry reattachable`: A's delayed service refusal arrives while same-ID retry B still streams, and B remains reattachable. |
| Stale same-ID stream frames | `ghosts: a stale same-id stage cannot replace or journal the active retry`: A emits a valid stage after B activates. B retains its progress, and B's verified journal contains only B's stage. |

RED receipt: with current suites and native seams but `LauncherRoot.tsx` and `pending-builds.ts` temporarily restored to `a77fd2c6`, `npm run launcher:test` exited `1`. Its footer named both failures: the dangling `pending:order` removal could not return to Back, and the live volatile failure offered no Discard. Current product files were restored to `0b9ba3ca` before the three acceptance additions. No standalone log file was captured.

GREEN receipt: `npm run launcher:test` exited `0` with `13820 checks passed, 0 failed` and `launcher acceptance green`.

R3 RED receipt: before the action-identity fix, `npm run launcher:test` exited `1` with `13823 checks passed, 1 failed`; the footer reported `got [ false, false, false, null ], want [ true, true, false, null ]` for the thrown active-stream volatile failure. No standalone log file was captured.

R3 GREEN receipt: after the fix, `npm run launcher:test` exited `0` with `13825 checks passed, 0 failed` and `launcher acceptance green`.

R4 RED receipt: `/tmp/whim-beta1-chain10-r4-red.log`; `npm run launcher:test` exited `1` with `13828 checks passed, 1 failed`. The named assertion recorded `got [ true, true, false, null ], want [ false, false, false, null ]` for stale same-ID action authorization.

R4 GREEN receipt: `/tmp/whim-beta1-chain10-r4-green.log`; `npm run launcher:test` exited `0` with `13829 checks passed, 0 failed` and `launcher acceptance green`.

R4 FAST GATE receipt: `/tmp/whim-beta1-chain10-r4-gate.log`; `GATE_BASE=874be3307cabf29906be17137401723237a8ee3a ./scripts/gate.sh` exited `0` and printed `FAST GATE PASSED`.

R4 KNIP receipt: `/tmp/whim-beta1-chain10-r4-knip.log`; `npx knip` exited `0` with no findings or output.

R5 RED receipt: `/tmp/whim-beta1-chain10-r5-red.log`; `npm run launcher:test` exited `1` with `13831 checks passed, 2 failed`. The named assertion reported that the stale completion did not leave the active retry reattachable.

R5 GREEN receipt: `/tmp/whim-beta1-chain10-r5-green.log`; `npm run launcher:test` exited `0` with `13835 checks passed, 0 failed` and `launcher acceptance green`.

R5 FAST GATE receipt: `/tmp/whim-beta1-chain10-r5-gate.log`; `GATE_BASE=874be3307cabf29906be17137401723237a8ee3a ./scripts/gate.sh` exited `0` and printed `FAST GATE PASSED`.

R5 KNIP receipt: `/tmp/whim-beta1-chain10-r5-knip.log`; `npx knip` exited `0` with no findings or output.

R6 RED receipt: `/tmp/whim-beta1-chain10-r6-red.log`; `npm run launcher:test` exited `1` with `13835 checks passed, 2 failed`. The stale stage replaced B's progress (`generate` rather than `check`) and appeared in B's verified journal.

R6 GREEN receipt: `/tmp/whim-beta1-chain10-r6-green.log`; `npm run launcher:test` exited `0` with `13838 checks passed, 0 failed` and `launcher acceptance green`.

R6 FAST GATE receipt: `/tmp/whim-beta1-chain10-r6-gate.log`; `GATE_BASE=874be3307cabf29906be17137401723237a8ee3a ./scripts/gate.sh` exited `0` and printed `FAST GATE PASSED`.

R6 KNIP receipt: `/tmp/whim-beta1-chain10-r6-knip.log`; `npx knip` exited `0` with no findings or output.

Worker verdict: source coverage complete at `ddb01da336c2af0d74f66fbd26170d9837382905`. Root acceptance remains pending independent r7 review, integrated gates and fresh native restart smoke. These are Node/rendered checks; they do not claim an on-device write-outage test.
