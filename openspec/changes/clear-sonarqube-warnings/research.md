# Research digest: clear-sonarqube-warnings

## Relevant files

- [docs/capabilities.md](/Users/davrondjabborov/Work/other/Whim/docs/capabilities.md) — maps static-checks and harness-diagnostics to their live specs.
- [openspec/specs/static-checks/spec.md](/Users/davrondjabborov/Work/other/Whim/openspec/specs/static-checks/spec.md) — diagnostics are AST-only and honest code must produce zero diagnostics.
- [openspec/specs/harness-diagnostics/spec.md](/Users/davrondjabborov/Work/other/Whim/openspec/specs/harness-diagnostics/spec.md) — zero-warning policy; no inline suppression for product harness diagnostics.
- [docs/harness.md](/Users/davrondjabborov/Work/other/Whim/docs/harness.md) — local SonarJS ESLint mirror, external SonarCloud behavior, and protected config policy.
- [docs/decisions.md](/Users/davrondjabborov/Work/other/Whim/docs/decisions.md) — decision #19 zero-warning state; #37 sandbox/message constraints; #46 nav contract.
- [openspec/changes/sdk-navigation/specs/sdk-navigation/spec.md](/Users/davrondjabborov/Work/other/Whim/openspec/changes/sdk-navigation/specs/sdk-navigation/spec.md) — nav-depth is an untrusted `parent.postMessage` hint; no containment-surface changes.
- [src/sdk/navigation.tsx](/Users/davrondjabborov/Work/other/Whim/src/sdk/navigation.tsx:112) — sole current dirty source file and S2819 site.
- [build/assemble.mjs](/Users/davrondjabborov/Work/other/Whim/build/assemble.mjs:140) — outer page source-verifies nav-depth frames against its own iframe and host-stamps generation.
- [src/runtime/web/syscall.js](/Users/davrondjabborov/Work/other/Whim/src/runtime/web/syscall.js:47) — established equivalent `NOSONAR` precedent.
- [openspec/changes/archive/2026-07-13-fix-nav-postmessage/findings.md](/Users/davrondjabborov/Work/other/Whim/openspec/changes/archive/2026-07-13-fix-nav-postmessage/findings.md) — records SonarCloud finding `AZ9ciqsaZpP-TVNR4hrv`, rule S2819.

## Current behavior

`NavRoot` emits `{ __whimNavDepth: true, depth, generation }` after each stack-depth change through `runtimeWindow.parent.postMessage(..., '*')`.

The working tree is otherwise clean: `src/sdk/navigation.tsx` is modified and `openspec/changes/clear-sonarqube-warnings/` is untracked, containing only `.openspec.yaml`.

The dirty diff moves the explanatory `NOSONAR` from the `'*'` argument to the `postMessage` call at line 116, where SonarCloud reports S2819. It does not alter runtime bytes or frame contents.

`npm run lint` completed successfully (ESLint + `plugin:sonarjs/recommended-legacy`): zero local ESLint/SonarJS findings.

## Constraints and invariants

- Decision #19 / harness-diagnostics: warnings are not acceptable steady state; do not weaken checkers or add suppression mechanisms for generated-app diagnostics.
- `docs/harness.md`: local ESLint does not honor `NOSONAR`; it must remain green independently. SonarCloud is external/authoritative and does honor the comment. Do not disable or override SonarJS rules; ESLint config is Class 1 protected.
- Decision #37: preserve opaque sandbox, locked CSP, and the SDK/loader’s maximum authority of one-way `parent.postMessage`.
- SDK-navigation spec: nav depth is intentionally unauthenticated and is never exit authority. The outer runtime validates `ev.source === iframe.contentWindow`; it stamps its own generation before relay. Host back policy retains guaranteed exit.
- Do not substitute `location.origin`, `'null'`, or a guessed origin for `'*'`: the sender is an opaque `srcdoc` iframe and cannot derive the receiver’s origin. A nonmatching `targetOrigin` drops the frame.
- Any `src/sdk/` change is a build input; generated runtime/build artifacts must be produced by `npm run build`, never hand-edited.

## Exact files/findings that should be fixed

- `src/sdk/navigation.tsx:116` — SonarCloud S2819 on `parent.postMessage(..., '*')`, prior finding ID `AZ9ciqsaZpP-TVNR4hrv`. The current dirty edit places `// NOSONAR` on the reported call line and retains the full opaque-origin/source-auth explanation.
- No other local ESLint/SonarJS findings are present.

## Justified `navigation.tsx` NOSONAR exception

This is a context-specific false positive, not a wildcard-origin authorization choice. The child must address its parent, but the child has an opaque sandbox origin and no stable, expressible outer WebView origin. The outer runtime source-verifies the exact iframe window, treats the frame as untrusted, and controls exit behavior. `src/runtime/web/syscall.js` uses the identical opaque-child-to-parent transport and already documents the same exception.

## Suggested chain partition

- One chain: `src/sdk/navigation.tsx` only — retain/move the S2819 `NOSONAR` annotation and rationale; no behavioral split is warranted.
- Keep any newly reported external SonarCloud issue in a separate chain only once its rule, file, and location are available.

## Risks and unknowns

- I did not verify a fresh SonarCloud scan after the dirty annotation move: GitHub API access was unavailable, and SonarCloud is not runnable locally by design.
- I did not run `npm run build`, because this was read-only research and it regenerates tracked artifacts.

# Research digest: clear-sonarqube-warnings after live SonarCloud review

## Relevant files

- [docs/capabilities.md](/Users/davrondjabborov/Work/other/Whim/docs/capabilities.md) — read first; routes to static-checks, diagnostics, launcher, storage, and SDK-design specs.
- [docs/harness.md](/Users/davrondjabborov/Work/other/Whim/docs/harness.md:75) — SonarCloud is external; local SonarJS lint is an in-loop mirror; protected paths are Class 2.
- [repository-static-quality spec](/Users/davrondjabborov/Work/other/Whim/openspec/changes/clear-sonarqube-warnings/specs/repository-static-quality/spec.md:7) — zero findings except the documented opaque-origin navigation call.
- [docs/decisions.md](/Users/davrondjabborov/Work/other/Whim/docs/decisions.md:271) and [docs/spike2-findings.md](/Users/davrondjabborov/Work/other/Whim/docs/spike2-findings.md:31) — governing decision #37 constraints for `loader.js`.
- [src/sdk/navigation.tsx](/Users/davrondjabborov/Work/other/Whim/src/sdk/navigation.tsx:62) — navigation stack, the specified `Object.hasOwn` site at line 72, and the documented target-origin exception.
- Listed test/support files — acceptance harnesses for server, bridge, launcher, storage, and SDK navigation.
- Listed product files — launcher theme state/context, schema validator/differ, runtime loader, SDK surfaces, and SDK theme model.

## Current behavior

The live inventory is 48 new-code findings. The non-protected surface includes server tests, host tests and helpers, runtime loader code, SDK surfaces/tests/theme, and one non-exception navigation finding.

The current navigation edit is limited to moving `NOSONAR` onto the reported `postMessage` call at [line 116](/Users/davrondjabborov/Work/other/Whim/src/sdk/navigation.tsx:116). Its explanatory comment remains directly above at lines 114–115. The `'*'` argument and emitted depth-frame shape are unchanged. The separate `Object.prototype.hasOwnProperty.call` site remains at [line 72](/Users/davrondjabborov/Work/other/Whim/src/sdk/navigation.tsx:72).

Local ESLint produced no diagnostics for the listed files it analyzes. It intentionally ignored `src/host/bridge/test/acceptance.ts`, `src/host/storage-engine/test/acceptance.ts`, and `src/runtime/web/loader.js`; this does not clear their SonarCloud findings.

The test files are executable acceptance nets, not incidental helpers. The product files preserve launcher theme behavior, additive-only schema evolution, trusted sandbox loading, SDK semantic-token rendering, and inert theme sanitization.

## Constraints and invariants

- `docs/harness.md`: do not alter Sonar/ESLint/gate configuration or use general suppression. `NOSONAR` is honored by SonarCloud but not ESLint; code must remain clean under both.
- Class-2 findings in `.codex/hooks/**`, `build/build.mjs`, `invariants/sandbox-isolation/run-against-build.mjs`, `scripts/git-cleanup-check.sh`, and `scripts/sync-codex.mjs` are outside normal agent-edit scope. Their remediation is human-ratified only.
- Decision #40 / storage specs: preserve exact structured errors and hints, closed field types, never-reused burned IDs, additive DDL only, and monotone accumulated `_meta`.
- Decision #37 / spike2: loader reachable authority must not exceed `parent.postMessage`; preserve CSP, iframe reset, source/nonce handling, trusted-vantage probes, and no `blob:` script enablement.
- SDK design-system spec: theme data remains inert and field-sanitized; components retain semantic-token-only props and no DOM exposure.
- SDK-navigation spec: depth is an untrusted hint; host exit policy remains authoritative. The opaque `srcdoc` child cannot express its parent origin as a non-wildcard target origin, so the documented `'*'` call and receiver-side `ev.source` boundary remain intact.

## Integration points

- `npm run server:test`, `npm run bridge:test`, `npm run launcher:test`, `npm run storage:test`, and independently discovered `src/sdk/test/*.acceptance.tsx` cover the listed test files.
- `validateArtifact` and `diffSchemas` in [schema.ts](/Users/davrondjabborov/Work/other/Whim/src/host/storage-engine/schema.ts:170) feed both storage behavior and static checks.
- `NavRoot` drives loader-held internal bootstrap; its depth frame is consumed by outer runtime/host back-policy.
- Any edit under `src/runtime/web/` or `src/sdk/` is a build input; generated artifacts are build outputs, never hand-edited.

## Risks and unknowns

- Individual live SonarCloud rule keys and finding IDs were not independently recovered for every issue; the live UI inventory supplies the file/title/line scope used for implementation.
- The protected/non-protected split is based on the repository’s protected-path policy and the live inventory.
