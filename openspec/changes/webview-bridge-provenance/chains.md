# Context chains: webview-bridge-provenance

**HUMAN-BOOTSTRAP chains** edit `CONFIG_SET` (control-plane) files: chain-1 (one line in `scripts/gate-full.sh`) and chain-2 (`build/assemble.mjs`, `build/build.mjs`). For each one, the implementer writes the listed edits in its worktree. A reviewer reads them, and the dispatcher commits them into the chain's base before the chain gates with the unmodified `scripts/gate.sh` (`GATE_BASE` moves to that commit). No owner approval: the protected-file system is off (owner decision 2026-09-21; `protect-harness.sh` is not wired in `.claude/settings.json`), and only the `CONFIG_SET` tripwire remains, which needs the edit committed into the base, nothing more (owner confirmed 2026-11-22). No chain edits `invariants/`. A chain that finds it needs an owner edit there stops and reports.

Every node/npm command and every gate runs under the RSS watchdog. Device work (chain-5) uses only Whim_Verify on emulator-5560 and at most one iOS simulator, each started and stopped by the chain.

## chain-1: runtime-bridge-probes — HUMAN-BOOTSTRAP

- tasks: 1.1–1.6
- rationale: the three in-frame runtime scripts, the verdict shape and the new desktop suite share one vocabulary: the captured bridge record, the stub identity and the `bridge` side field.
- files:
  - `src/runtime/web/neutralize.js`, `src/runtime/web/loader.js`, `src/runtime/web/probes.js`
  - new `src/runtime/test/bridge-provenance.desktop.mjs`
  - `package.json` (`runtime:provenance-verify`)
  - README.md and the docs/security count lines
- bootstrap edits (commit first): `scripts/gate-full.sh`, one `check "bridge-provenance" npm run -s runtime:provenance-verify` line beside `deliver-by-source`
- reads:
  - specs/sandbox-isolation/spec.md (this change) §"The mini-app frame holds no native bridge object" and §"Bridge presence at start is reported, not counted"
  - live openspec/specs/sandbox-isolation/spec.md §"Global neutralization is surgical, not total"
  - design.md D4, D7 (desktop probe suite)
  - research.md Part B §Current behavior, §Constraints, §Pattern census
  - handoff: none
- writes-contract: handoff/bridge-record.md (the frozen record's shape, how the loader captures it, the `bridge` verdict field, the three probe names, the desktop suite's harness entry points that chain-2 extends)

## chain-2: outer-page-auth-and-exposure — HUMAN-BOOTSTRAP

- tasks: 2.1–2.6
- after: chain-1 (extends its desktop suite; both chains regenerate the runtime build)
- rationale: everything the outer page does differently (the `auth` control, the signer, the log buffer, the warm control and the exposure probe), plus the adversarial fixture the outer page's build registers. All of it lives in or is registered through `build/`.
- files:
  - `build/assemble.mjs`, `build/build.mjs` (`APPS`)
  - new `fixtures/adversarial/bridge-reach.app.tsx`
  - `src/host/launcher/dev-probe-fixtures.ts`
  - `src/runtime/test/bridge-provenance.desktop.mjs`
- bootstrap edits (commit first):
  - `build/assemble.mjs`: `auth`/`warm` controls, the signer on every RN post, the pre-`auth` log buffer, the exposure probe;
  - `build/build.mjs`: one `APPS` entry `'bridge-reach'`.
- reads:
  - specs/webview-message-provenance/spec.md §"The token reaches only the outer page's main frame", §"The outer page signs every message it sends to RN" and §"The outer page measures what a navigated frame can reach"
  - design.md D1 (page half), D2, D3, D5
  - research.md Part A §Current behavior (poster list), Part B §Integration points (outer probe)
  - handoff: handoff/bridge-record.md
- writes-contract: handoff/page-envelope.md (the `auth`/`warm` control calls and when they are accepted, the exact envelope grammar, the full list of signed message kinds, the `bridge-exposure` payload, the canary constant, the fixture's id and what its forged frames carry)

## chain-3: host-message-auth

- tasks: 3.1–3.6
- after: chain-2
- rationale: every RN consumer of runtime-page messages, the token lifecycle and the test suites that feed `onMessage` share one seam: the verifier at the head of each consumer.
- files:
  - new `src/host/launcher/runtime-message-auth.ts`
  - `src/host/launcher/useMiniAppHost.ts`, `MiniAppView.tsx`, `webview-pool.ts`, `DevProbeScreen.tsx`
  - `src/host/NetworkDenyProbeScreen.tsx`
  - `src/host/launcher/test/native-host.tsx`
  - the six existing suites named in 3.5
  - new `src/host/launcher/test/runtime-message-auth-ui.suite.tsx` and its unit suite
- reads:
  - specs/webview-message-provenance/spec.md §"Each page load of a hosting WebView has its own secret token" and §"RN drops every unsigned message before reading it"
  - design.md D1 (host half), D2, D5 (RN record), D7 (host suite)
  - research.md Part A §Current behavior (RN parse), §Pattern census, §Risks (test list)
  - handoff: handoff/page-envelope.md
- writes-contract: handoff/host-auth.md (where the token is minted and delivered, the drop counter and exposure record and where DevProbeScreen shows them, the signed-frame test helper)

## chain-4: native-main-frame-filter

- tasks: 4.1–4.6
- rationale: both platforms' native second layer and their shared static check share the #74 seams and vocabulary. It touches no file another chain touches, so it runs in parallel with chains 1–3.
- files:
  - `android/app/src/main/java/com/whim/webview/` (manager and new view subclass), the Android build types for the debug switch
  - `ios/Whim/` (new swizzles beside `WhimWebViewNetworkDeny.m`, Xcode project entry)
  - new `checks/test/release/webview-main-frame.suite.ts` and its registration
  - new `docs/security/upstream-react-native-webview-main-frame.md`
- reads:
  - specs/webview-message-provenance/spec.md §"Native code drops messages from frames other than the main frame"
  - specs/sandbox-isolation/spec.md (this change) §"iOS refuses sub-frame navigations to anything but the frame's own document"
  - design.md D6, D9 (iOS sub-frame navigation refusal)
  - research.md Part A §Current behavior (Android/iOS bridge), §Integration points (native seams)
  - live openspec/specs/sandbox-isolation/spec.md §"The native refusal is locked by the checks and proven on device" (the static-check pattern)
  - handoff: none
- writes-contract: handoff/native-filter.md (how to build with the force-fallback switch on, what the static check asserts, build commands used)

## chain-6: exposure-telemetry

- tasks: 7.1–7.5
- after: chain-3 (consumes its exposure record and `exposureCode`)
- rationale: the upload of the exposure result and the reworded error-details consent copy are one disclosure: the record shape, its dedupe, the gate it rides, and every surface that describes it must agree.
- files:
  - `contract/src/index.ts` (`DiagnosticRecord`), `contract/src/disclosure-manifest.ts` (row description only)
  - `src/host/logging/diagnostic.ts`, `src/host/logging/diagnostics.ts`
  - the RN exposure handler's single enqueue call (the site chain-3's handoff names)
  - `src/host/launcher/copy.ts`
  - `deploy/site/privacy.html`, `deploy/site/fr/privacy.html`
  - `src/host/logging/test/diagnostics.suite.ts`, `server/test/diagnostics.suite.ts`, `server/test/contract.suite.ts`
- reads:
  - specs/device-diagnostics/spec.md (this change), all three requirements
  - live openspec/specs/ai-data-consent/spec.md §§ on when the manifest widens
  - design.md D5 (record fields), D8
  - handoff: handoff/host-auth.md
- writes-contract: handoff/exposure-telemetry.md (the record as uploaded, the dedupe key, the copy keys changed with their new en/fr text)

## chain-5: device-verification-and-docs

- tasks: 5.1–5.5, 6.1–6.3
- after: chain-3, chain-4, chain-6
- rationale: the four on-device cases exercise the merged whole, and their evidence is what the decision, the security doc and the follow-up issues record. Splitting docs from evidence would force a diary handoff.
- files:
  - `docs/security/2026-11-19-verdict-channel.md`, `docs/decisions.md`
  - GitHub issues (6.3)
  - no product code: a defect found on device goes back to the dispatcher as a fix, not into this chain
- reads:
  - specs/webview-message-provenance/spec.md (all scenarios, as the checklist)
  - specs/sandbox-isolation/spec.md (this change)
  - design.md Risks and Open Questions
  - research.md §Pattern census (both parts)
  - handoff: handoff/host-auth.md, handoff/native-filter.md, handoff/page-envelope.md, handoff/exposure-telemetry.md
- writes-contract: none
