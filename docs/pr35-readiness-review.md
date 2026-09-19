# PR #35 readiness review

Reviewed product commit: `98e94949abcebc5969f8f08c0accdeae971e76bf`.
Base: `3a66cca3993aab0ce4680560fea326c349c55730`.
Updated: 2026-09-19. PR: https://github.com/Davron2004/Whim/pull/35.

The two server accounting defects are fixed and independently reviewed. The full
local gate passed on `98e9494`. iOS 27 startup was fixed earlier in `adf271e`;
fresh iOS native network-denial acceptance now passes, including a removal control
that produces traffic. The normal app is restored and its saved data still loads.

Keep the PR in draft for the remaining whole-branch review and history cleanup.
These results close the specific defects below; they do not establish that every
part of this large branch is ready. The owner will review and prune tests
separately. No broad test cleanup or history rewrite was performed in this batch.

At the start of this follow-up, both GitHub jobs and Sonar were green on remote
head `965c80a`. That is separate from the local gate on `98e9494`; consult the PR
for checks on any later pushed head. CI does not run every full-local-gate check.

## Scope inventory

The table is the original September 18 inventory at `865f7af`, retained for scope
orientation. Counts are a non-overlapping classification of Git's base-to-head
text diff; binary assets contribute files but no text lines. At `98e9494`, the
whole diff is 519 files, +53,429/-1,337 lines across 394 commits since the base.

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

In that original inventory, 21% of added lines were docs/specs and 35% were tests.
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
since the September 18 review; this was not a new audit of every unchanged
implementation.

The sampled release tests have throwing assertions and exercise
temporary asset/listing/configuration trees and mutations. Native wiring tests
check purposeful mutants, including a stock Android manager, missing iOS rules,
and removal of fail-closed behavior. This establishes some failure detection,
not that every test or suite is worth retaining. Their structural checks do not
establish what a real WebView does on the network.

The prior fix batch replaced launcher source scans with rendered interactions and
added failure-path regressions. The owner plans to review the accumulated tests.
Assess each by the defect it catches, its realism, duplication, and maintenance
cost. Neither assertion counts nor mandatory red-before-green ceremony establish
test quality. This batch reused rewrite cases and added two focused generation
settlement cases; it did not add a new test framework or fix-loop paperwork.

GitHub then exposed a separate timeout-test flake: the deliberately stalled fake
model and in-process request have no socket, and `AbortSignal.timeout` does not
keep Node alive. An isolated child reproduced exit 13 before the deadline fired.
The three stalled requests now have a scoped, cleared two-second test watchdog.
Disabling the production deadline still fails explicitly; it cannot silently pass.
The isolated tests passed 37 checks, and the full server suite passed 2,658 checks
with TypeScript/lint passing. This test-only repair was independently reviewed.

## Sonar triage

The original September 18 triage found a Sonar gate of `OK`, zero vulnerabilities,
and 296 code-smell findings across 29 rules. This table is historical:

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

The remote analysis at `965c80a` reported 177 new issues, zero security hotspots,
and 0% imported coverage. The earlier 171-issue count predates the scene fix.
A green Sonar gate is not a clean audit, and 0% imported coverage does not mean
the locally executed tests never ran. Use the current PR analysis for later counts.

## Resolved findings and their limits

1. **iOS 27 startup — fixed in `adf271e`.** The scene lifecycle migration and
   normal Release acceptance are recorded in the
   [startup issue](../openspec/changes/platform-release-readiness/ios27-startup-issue.md).
   Warm/cold URL-context delivery and saved Water Counter state passed on
   September 18. The September 19 normal rebuild also launches and cold-opens
   Water Counter with the same 3 glasses and 3 history entries. External
   Associated Domains delivery remains a separate acceptance item.
2. **Rewrite retry accounting — fixed in `c70b6b8`, integrated in `c4e6624`.**
   Attempt A returned 18 tokens but an unusable plan; retry B failed with an ID
   whose authoritative statistics also reported 18 tokens. The old aggregate
   `creditedAny` flag left device usage at 18. Credit ownership now follows each
   provider ID, so device usage reaches 36 without crediting A twice, and costs
   from both attempts resolve. The request row retains the 18 tokens known during
   the request; it is not retroactively changed to 36. Three existing rewrite
   cases now check totals, credit ownership, provider lookups and settled costs.
3. **Generation settlement recovery — reproduced and fixed in `a6ec9cd`,
   integrated in `98e9494`.** A terminal ledger write failure previously skipped
   usage resolution after the result had already been delivered. Teardown now
   makes at most two settlement attempts using the same captured values, logs
   failures, and starts usage resolution even if both writes fail. Capacity is
   released and the generation untracked before bookkeeping. A delivered result
   stays consumable; actual pipeline/stream failures still propagate. Two
   SQLite-backed route cases cover first-write failure and persistent rejection,
   including one terminal result, slot release, token credit and cost resolution.
   If persistence keeps rejecting the terminal write, its row can remain
   unfinished. The bounded retry does not guarantee storage recovery.

Both server changes received independent code review with no blocking findings.
The primary-checkout server suite passed after the rewrite fix (2,664 checks);
the final combined full gate passed with all 41 OpenSpec items valid. It included
Node suites, lint/typecheck, knip, Metro and Chromium checks. A worktree-only
production-bundle path assertion failed because its shared dependency resolved
into the primary checkout; the unchanged check passed in the primary checkout.
No paid provider calls were made, and the production VM has not been redeployed
with these changes.

## Device acceptance and remaining release work

Historical Android evidence is valid: platform-release-readiness/progress.md
records the September 15 native-deny canary with zero HTTP/TLS hits and a removal
negative control that produced traffic. It must not be relabeled as missing merely
because an older handoff predates that run.

September 18 Android acceptance passed normal launcher/Water Counter interaction,
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

September 19 iOS acceptance used an iPhone 18 Pro simulator on iOS 27.0, Xcode
27.0 (`27A266a`), Release configuration, and product source `98e9494`:

| Installed variant | Bundles served | HTTP hits | TLS connections | Verdict |
| --- | ---: | ---: | ---: | --- |
| Native rule attached, network probe enabled | 6 | 0 | 0 | `expect=zero` passed |
| Only native rule attachment removed, same probe | 6 | 5 | 4 | `expect=leak` passed |

Each canary ran for 90 seconds. The positive screenshot also shows WebKit's
content-blocker error for the host top-frame attempt. Both runs loaded all six
bundle cases; the removal control demonstrates that the canary can see escaping
traffic. This supersedes the earlier zero-bundle failure from the crashing build.
The last DNS diagnostic row is partly clipped in the screenshot, and no DNS
packet capture was performed. The HTTP/TLS result is not a DNS-denial verdict.

The Mac was locked, so this run used supported launch commands and simulator
screenshots. It did not repeat the missing-rule Retry/Home interaction checks;
the September 15 iOS 26.5 receipts for those remain historical evidence. Task
18.5 is not marked complete by this narrower run. Simulator acceptance also does
not satisfy the physical signed-iPhone requirement.

Temporary probe and native-rule edits were restored byte-for-byte. All three
Release builds passed; the final normal app was reinstalled and visually checked,
then cold-opened through `devicectl --payload-url` with saved state intact. This
exercises URL-context delivery, not published association-file trust. CocoaPods
regenerated four local checksums without changing dependency versions; the
tracked lockfile was restored after the builds. A later local iOS build may need
`pod install` again to regenerate the matching manifest.

Logs, screenshots and executable/bundle hashes are retained locally under
`~/.cache/whim-pr35-2026-09-19/`: `pr35-accounting-full-gate.log` and the
`ios-netdeny/` directory, including `zero-canary.log`, `leak-canary.log`, the
three build logs, `*-artifact.sha256`, and normal-app screenshots. These local
receipts support the results recorded here; they are not committed artifacts.

The remaining owner/device requirements include physical signed-iPhone acceptance,
cellular generation and cancellation with provider-cost reconciliation, and app-link
verification using the published signing fingerprints. Store-account setup,
production signing and uploads remain in the existing release tasks. The active
OpenSpec deltas also need normal synchronization/archive at their actual completion.

## Handoff to the next review

The next merge-readiness work is the owner's test-value review, a final review of
the whole branch, and history cleanup with the final tree preserved. Recheck CI
and Sonar on the resulting head. Cosmetic findings and a possible control-plane
split are scope decisions, not demonstrated product defects.

Treat physical-device, cellular, association/signing and store work as explicit
release obligations. The existing release tasks record owner prerequisites that
may remain pending at merge; do not silently declare those complete or make
store upload a prerequisite for merging source. No merge into `main`, history
rewrite or production deployment was performed in this follow-up.
