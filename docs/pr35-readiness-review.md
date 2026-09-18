# PR #35 readiness review

Reviewed product commit: `865f7af0c431984f0abf9fce3b514063cfd912a7`.
Base: `3a66cca3993aab0ce4680560fea326c349c55730`.
Review date: 2026-09-18. PR: https://github.com/Davron2004/Whim/pull/35.

The full local gate, both GitHub jobs, and Sonar passed on the reviewed product
commit. Those checks establish the recorded automated coverage, not complete
release acceptance. This review covers the changed containment/storage paths,
server cancellation/accounting/admission, release tests, and available devices.

## Scope inventory

Counts are a non-overlapping classification of Git's base-to-head text diff.
Binary assets count as files but contribute no text lines.

| Area | Files | Added lines | Deleted lines |
| --- | ---: | ---: | ---: |
| Product/runtime | 126 | 10,876 | 1,078 |
| Tests | 96 | 18,394 | 133 |
| Deploy/release | 101 | 10,577 | 55 |
| Docs/specs | 124 | 11,225 | 25 |
| Generated/binary | 32 | 272 | 0 |
| Harness/config | 22 | 236 | 43 |
| Other tools | 13 | 779 | 2 |
| Total | 514 | 52,359 | 1,336 |

Only 21% of added lines are documentation/specifications; 35% are tests.
The volume reflects several projects combined into one launch branch:

| Review unit | Contents | Disposition |
| --- | --- | --- |
| Public generation | API, admission, policy/reporting, request ledger, cancellation, provider integration | Keep server and device wire contracts together; review accounting and failure paths first |
| Launcher launch flows | Consent, connectivity, refusals, reporting, app links | Keep matching server contracts and behavioral tests |
| Native containment | Android WebView manager, iOS rule list, runtime probes | Required security behavior; retain native evidence and negative controls |
| Release engineering | Native project configuration, icons, signing/listings, fastlane | Required for store release; upload automation can be deferred for an internal build |
| Deployment operations | GCP/Caddy, resizing, replay load tests, admin scripts | Intentional work; independently reviewable, but required for the public-service launch |
| Agent control plane | Codex skill mirrors, Claude policy hooks, devcontainer changes | Best candidate for a separate PR; retain required synchronization and policy tests when splitting |
| OpenSpec history | Proposals, research, handoffs, progress and archived fixes | Retain evidence under the project workflow; review current contracts separately from historical notes |

The generated asset manifest and 31 PNGs have consumers in the native projects
and store listings. They are not unexplained output to delete. No history rewrite
or scope removal was performed during this review.

## Containment and test review

No introduced containment, storage-group/fork isolation, or realm-reset authority
defect was established in the reviewed paths. Android installs its denying WebView
manager before use. iOS installs HTTP/WebSocket rules and fails closed if they are
unavailable. The existing startup deadline and Retry behavior handle that closed
state. Bridge dispatch, storage mapping, and the fork implementation are unchanged
in this diff; this was not a new audit of every unchanged implementation.

The release tests have genuine throwing assertions. Sampled suites exercise
temporary asset/listing/configuration trees and mutations. Native wiring tests
check purposeful mutants, including a stock Android manager, missing iOS rules,
and removal of fail-closed behavior. Keep these tests. Their structural checks do
not establish what a real WebView does on the network.

The prior fix batch replaced launcher source scans with rendered interactions and
added failure-path regressions. Additional cleanup should be justified by a test's
failure-detection value, rather than its line count or use of a custom runner.

GitHub then exposed a separate timeout-test flake: the deliberately stalled fake
model and in-process request have no socket, and `AbortSignal.timeout` does not
keep Node alive. An isolated child reproduced exit 13 before the deadline fired.
The three stalled requests now have a scoped, cleared two-second test watchdog.
Disabling the production deadline still fails explicitly; it cannot silently pass.
The isolated tests passed 37 checks, and the full server suite passed 2,658 checks
with TypeScript/lint passing. This test-only repair was independently reviewed.

## Sonar triage

At the reviewed product commit, Sonar's gate was `OK`, with zero vulnerabilities
and 296 code-smell findings across 29 rules:

| Family | Count | Treatment |
| --- | ---: | --- |
| Assertion recognition (`S2699`) | 125 | Shared helper now delegates to `node:assert.ok`; the actual local rule reports zero across all nine affected suites |
| Shell conventions (`S7688`, `S7679`) | 112 | Quoted bracket tests and positional-argument style; defer cosmetic churn |
| Context-sensitive warnings | 19 | Review semantics individually; do not apply automatic replacements |
| Other style/maintainability | 40 | Separate cleanup, with runtime compatibility checked |

Retain the actual `webkitRTCPeerConnection` name in the adversarial probe and the
`buffer` package import in the Hermes bootstrap. The suggested naming/`node:`
changes would change what those paths mean. Keep immutable Docker digest pins;
the accompanying tag documents the intended version. Unknown-value formatting
and unused delegate parameter names are diagnostic/style work, not demonstrated
release failures.

The five missing-shell-default findings describe deliberate selective matches:
unmatched inputs continue into the normal validation/control flow. The nested
admission handle constructor intentionally closes over controller state, and its
stale/duplicate-release behavior is tested. Parameter counts in the private unary
helpers are maintainability work, not evidence of a failed request.

The assertion change preserves `assert(boolean, string): void` and the custom
runner. Deliberately false synchronous and awaited assertions still produce exit
1; a deliberately assertion-free test still triggers S2699. All 220 checks passed.
The reusable Node-test pattern is recorded in CLAUDE.md, inherited by AGENTS.md.
The implementation is commit `8accab3`. The current remote verdict belongs to
PR #35's checks and description; local analyzer results alone do not prove it.
The full local gate passed on `8accab3`, including the browser suites and all 41
OpenSpec validations (`/tmp/pr35-assertion-full-gate.log`). The helper and guidance
were independently reviewed; no checker or assertion suppression was added.

## Findings that affect merge readiness

1. **Confirmed: [iOS 27 startup failure](../openspec/changes/platform-release-readiness/ios27-startup-issue.md) with the installed SDK.** Both the fresh
   probe build and a restored normal Release build stop in UIKit before React
   Native starts. The native log says `UIScene life cycle is required for apps
   built with this SDK`. `ios/Whim/AppDelegate.swift` creates the window through
   the application delegate, and Info.plist has no scene configuration. Apple's
   [scene-lifecycle migration requirement](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)
   matches the failure. Adopt the scene lifecycle, preserve app-link delivery,
   then rerun the iOS acceptance. The normal build was restored; this review did
   not patch the lifecycle or repeatedly relaunch the crashing app.
2. **Confirmed: failed rewrite retries lose authoritative token usage.** The
   real `/v1/rewrite` route was exercised with successful attempt A (18 tokens),
   followed by failed attempt B (18 tokens). The resolver fetched statistics for
   both IDs, but device usage remained 18 rather than 36. `creditedAny` in
   `server/src/routes/rewrite.ts` treats all attempts as credited once any attempt
   succeeds, so `resolveUnaryUsage` skips B's token reconciliation. Track credited
   attempts individually and add a two-attempt regression that also rejects
   double-crediting. Reproduction: `/tmp/pr35-rewrite-repro.mjs`; failing log:
   `/tmp/pr35-rewrite-repro.log`. No paid provider calls were made.
3. **Static finding, not yet reproduced: generation settlement recovery.** In
   `server/src/routes/generate.ts`, teardown releases capacity and then settles the
   ledger before starting usage resolution. A transient settlement exception skips
   that resolution and can leave an unfinished row. Reproduce with a store that
   fails its first terminal settlement before choosing a bounded recovery change.
   Capacity leakage is not claimed here; release happens first.

## Device acceptance and remaining release work

Historical Android evidence is valid: platform-release-readiness/progress.md
records the September 15 native-deny canary with zero HTTP/TLS hits and a removal
negative control that produced traffic. It must not be relabeled as missing merely
because an older handoff predates that run.

Fresh Android acceptance passed normal launcher/Water Counter interaction,
persistence across process restart, and Back navigation. The native-deny canary
passed with seven served bundles and zero HTTP/TLS hits; the removal negative
control passed with six HTTP and four TLS hits. The existing bridge, storage and
version-store native probes also passed, including process-restart persistence,
schema evolution, stale-generation rejection, and version-store fork/compaction
checks. This was the Pixel_10_Pro_XL emulator on Android 17/API 37 with WebView
145.0.7632.218. Temporary source controls were restored byte-for-byte.
The normal APK was rebuilt, reinstalled, and visually checked afterward.

DNS packet capture and the full launcher fork UI were not covered. The
`android:release` command builds/installs but tries to launch the old `com.whim`
package; the correct package launches successfully. Subsequent acceptance used
the standard Gradle `installOffline` task. That command mismatch is a developer
tooling follow-up, not an APK startup failure. No physical phone was connected.

Fresh iOS acceptance is blocked by the confirmed startup failure above. Its
zero-canary correctly failed with zero bundles loaded; zero traffic from an app
that never launched is not a containment pass. No iOS removal-control verdict is
claimed. Simulator results do not satisfy the physical-device requirements.

The remaining owner/device requirements include physical signed-iPhone acceptance,
cellular generation and cancellation with provider-cost reconciliation, and app-link
verification using the published signing fingerprints. Store-account setup,
production signing and uploads remain in the existing release tasks. The active
OpenSpec deltas also need normal synchronization/archive at their actual completion.

Keep this PR in draft. Resolve the two reproduced blockers, test the settlement
failure path, then complete the outstanding device/release acceptance. Cosmetic
Sonar cleanup and a control-plane split can be reviewed separately.
