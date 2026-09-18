# PR 35 review findings

Reviewed base: `9701e6a2ebfaf50c5bfb3b8ad96dc98e9318aac2` on `integration/store-launch`.
The user authorized fixes, then explicitly allowed adapting the fix-loop mechanics.

## Server

- F01: Clarify/rewrite can retain global unary capacity when ledger settlement throws. A capacity-one Hono reproduction returned 500 then 429 after storage recovered.
- F02: Rewrite credits aggregate usage but omits usage from request-ledger settlement, leaving token columns at zero.
- F04: Load-test success accepts missing terminal events and incorrect over-cap refusal types/counts.

## Launcher

- F03: A response from an old configured server can mark the replacement connectivity loop online and suppress its retries.
- F08: The exit scanner and app-link/settings source-string tests constrain source arrangement without exercising the claimed UI behavior. Replace them with meaningful interaction coverage while preserving useful invariants.
- F09: DebouncedProbe exposes a test-only waiting API whose claimed debounce semantics are false; remove unnecessary production test scaffolding when deterministic test-owned synchronization suffices.

## Release and deployment

- F05: The asset contract and validator accept PNG foregrounds, but generation always reads SVG and records an SVG source.
- F06: Bootstrap's Docker-key download follows redirects without restricting them to HTTPS (Sonar shell:S6506).
- F07: The IPv6 firewall predicate accepts required text fragments with ineffective rules. Exercise installed commands/rules instead.
- F10: Exact production-default and asset-count pins add little protection; the runbook-variable substring test mistakes examples/comments for executable consumption. Replace these with checks of required outputs and actual configuration behavior.

## Outside this fix batch

The suspected iOS startup race was withdrawn: fail-closed startup and retry are intentional and implemented. Detached-generation UI races predate this PR and were not reproduced end to end. Splitting Codex skills/session notes is a PR-scope suggestion, not a confirmed product defect. Sonar's custom-assertion warnings require individual triage, not blanket suppression.
