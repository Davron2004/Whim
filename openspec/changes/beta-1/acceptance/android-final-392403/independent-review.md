# Android 392403 QA evidence review

Reviewed the completed Android 392403 evidence at `openspec/changes/beta-1/acceptance/android-final-392403/`, its raw manifest and queue transcripts, the source pin, and the cited helper hashes. Product source is `c76191d34343510c5c5af748132c5b2a650067ee`; the build/CI head is `a58403876ffb62977f414e87bba8b4093f338eeb`. The product-file diff between them is empty.

VERDICT: clean

REPORT HONESTY: matches evidence. The receipt preserves two invalid captures and does not use them as proof: the cold-focus stale/null-root capture and the interruption XML. It also marks both early queue attempts incomplete and excludes human keyboard drag.

FINDINGS: none.

SPEC CONFORMANCE: the reviewed Android evidence supports the claimed automated cases. It does not close human keyboard-drag or iOS acceptance.

The report-sheet image shows a focused draft field above the keyboard with Send report disabled; no submission occurred. The SDK-low image and XML show the Style Gallery Amount field at `427`, fully above the numeric keyboard. The fresh future-failure destination shows Making it/Reading your plan, and its terminal capture is the intended generic failure; the old settled terminal capture remains explicitly invalid. The update case shows the update interstitial, and the reopened-home XML has two `Hello App` entries, matching the recorded before/after installed count and one generation request. The interruption evidence is limited to its PNG because the retained XML records the helper's idle/null-root failure.

The final queue sequence is the only queue proof credited. Its observer records position 2, position 1, Making it after B, and completion. Raw B closes at `2026-09-30T15:35:42.293Z`; the active-after-B observation starts at `2026-09-30T15:35:50.580337Z` and completes at `2026-09-30T15:35:58.416833Z`, after that closure. The raw log has 19 admitted generation requests: 13 native requests plus six controlled holder requests across the three queue attempts. It has 18 completed HTTP records because the cold-ended case intentionally stops the server before its admitted request can receive a response. This reconciles the stated counts.

For the cold-ended case, the captures show one generic failed ghost before and after a cold launch, no Report action, and the reopened generic terminal. The receipt records one native request. The crash buffer manifest is empty (`0` bytes, SHA-256 of an empty file). The reviewed helper copies match the recorded action, observer, and serial-helper SHA-256 values. The shutdown entry records the owned emulator, QA server, and holder as absent; I treated that as receipt evidence and did not probe live resources.

Limits remain material: I did not credit the first or second queue captures, the invalid interruption XML, or human keyboard drag. This was an evidence review only; it ran no device commands and does not establish iOS acceptance, a fresh device run, or runtime behavior beyond the preserved Android evidence.
